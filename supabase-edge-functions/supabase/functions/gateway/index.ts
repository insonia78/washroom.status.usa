// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.
// Setup type definitions for built-in Supabase Runtime APIs
// import "@supabase/functions-js/edge-runtime.d.ts";

import {
  buildGatewayHeaders,
  gatewayAuthorizationHeader,
} from "../_shared/gateway-auth.ts";
import {
  isJwtTokenDatabaseConfigured,
  revokeJwtTokenRecordsForUser,
} from "../_shared/jwt-token-store.ts";
import { buildForwardHeaders as buildUserForwardHeaders } from "./build-forward-headers.ts";
import { SERVICES } from "./models.ts";
import { supportedRoutes } from "./supported-routes.ts";
import type { VerifiedToken } from "./utils.ts";
import { verifyTokenWithValidator } from "./verify-token-validator.ts";

console.log("Washroom Gateway init");

const defaultCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": [
    "authorization",
    "x-client-info",
    "apikey",
    "content-type",
    "accept",
    "origin",
    "x-washroom-gateway-caller",
    "x-washroom-gateway-secret",
    gatewayAuthorizationHeader,
  ].join(", "),
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const FUNCTION_NAME = "gateway";
const FUNCTION_BASE_PATH = `/functions/v1/${FUNCTION_NAME}`;
const FUNCTION_PATH_PREFIXES = [FUNCTION_BASE_PATH, `/${FUNCTION_NAME}`];
const registrationApiUrl = Deno.env.get("WASHROOM_REGISTRATION_API_URL");
const turnstileProtectionEnabled = false;
const turnstileSecretKey = Deno.env.get("TURNSTILE_SECRET_KEY");
const turnstileVerifyUrl = Deno.env.get("TURNSTILE_VERIFY_URL") ??
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const jwtCreatorUrl = Deno.env.get("JWT_CREATOR_URL");
const jwtValidatorUrl = Deno.env.get("JWT_VALIDATOR_URL");
const gatewayInternalSecret = Deno.env.get("GATEWAY_INTERNAL_SECRET");
const CONTAINER_HOSTNAME = "host.docker.internal";
const adminRole = "admin";
const defaultRetryDelayMs = 250;

type LogLevel = "info" | "warn" | "error";

// Derives a sibling edge-function URL by replacing the final path segment.
function deriveSiblingFunctionUrl(functionUrl: string | undefined, functionName: string): string | null {
  if (!functionUrl) {
    return null;
  }

  const parsedUrl = new URL(functionUrl);
  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  if (!pathSegments.length) {
    return null;
  }

  pathSegments[pathSegments.length - 1] = functionName;
  parsedUrl.pathname = `/${pathSegments.join("/")}`;
  return parsedUrl.toString();
}

const jwtRevokeUrl =
  Deno.env.get("JWT_REVOKE_URL") ??
  deriveSiblingFunctionUrl(jwtCreatorUrl, "jwt-revoke") ??
  deriveSiblingFunctionUrl(jwtValidatorUrl, "jwt-revoke");
const placesApiUrl =
  Deno.env.get("PLACES_API_URL") ??
  deriveSiblingFunctionUrl(jwtCreatorUrl, "places-api") ??
  deriveSiblingFunctionUrl(jwtValidatorUrl, "places-api");
const frontendApiUrl = Deno.env.get("FRONTEND_API_URL") ??
  deriveSiblingFunctionUrl(placesApiUrl ?? undefined, "frontend-api");

// Emits a structured gateway log entry at the requested severity.
function logGatewayEvent(level: LogLevel, event: string, details: Record<string, unknown> = {}) {
  const payload = {
    event,
    functionName: FUNCTION_NAME,
    ...details,
  };
  const message = `[${FUNCTION_NAME}] ${JSON.stringify(payload)}`;

  if (level === "error") {
    console.error(message);
    return;
  }

  if (level === "warn") {
    console.warn(message);
    return;
  }

  console.log(message);
}

// Waits for the requested duration between retry attempts.
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reports only whether key request headers are present, not their values.
function getHeaderPresence(req: Request) {
  return {
    hasApiKey: Boolean(req.headers.get("apikey")),
    hasAuthorization: Boolean(req.headers.get("authorization") ?? req.headers.get("Authorization")),
    hasGatewayAuthorization: Boolean(req.headers.get(gatewayAuthorizationHeader)),
    hasGatewayCaller: Boolean(req.headers.get("x-washroom-gateway-caller")),
    hasGatewaySecret: Boolean(req.headers.get("x-washroom-gateway-secret")),
  };
}

// Collects request metadata used by gateway logs.
function buildRequestLogContext(req: Request, requestId: string) {
  const requestUrl = new URL(req.url);

  return {
    requestId,
    method: req.method,
    pathname: requestUrl.pathname,
    search: requestUrl.search,
    origin: req.headers.get("origin"),
    ...getHeaderPresence(req),
  };
}

// Returns the backend origin and path without exposing URL credentials or query data.
function summarizeBackendUrl(baseUrl: string) {
  const parsedUrl = new URL(baseUrl);

  return {
    backendOrigin: parsedUrl.origin,
    backendPathname: parsedUrl.pathname,
  };
}

// Converts unknown thrown values into readable error text.
function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Summarizes configured backend URLs and secret presence for startup logging.
function getConfiguredBackendsSummary() {
  return {
    hasRegistrationApiUrl: Boolean(registrationApiUrl),
    hasPlacesApiUrl: Boolean(placesApiUrl),
    hasFrontendApiUrl: Boolean(frontendApiUrl),
    hasJwtCreatorUrl: Boolean(jwtCreatorUrl),
    hasJwtRevokeUrl: Boolean(jwtRevokeUrl),
    hasGatewayInternalSecret: Boolean(gatewayInternalSecret),
    registrationBackend: registrationApiUrl ? summarizeBackendUrl(registrationApiUrl) : null,
    placesBackend: placesApiUrl ? summarizeBackendUrl(placesApiUrl) : null,
    jwtRevokeBackend: jwtRevokeUrl ? summarizeBackendUrl(jwtRevokeUrl) : null,
  };
}

// Reports whether a forwarded request body exists and its size and content type.
function summarizeRequestBody(requestBody: Blob | null) {
  if (!requestBody) {
    return {
      hasBody: false,
      bodySize: 0,
      bodyType: null,
    };
  }

  return {
    hasBody: true,
    bodySize: requestBody.size,
    bodyType: requestBody.type || null,
  };
}

// Produces a compact description of a response payload for logs.
function summarizeBodyPayload(payload: unknown) {
  if (typeof payload === "string") {
    return {
      responseShape: "text",
      textLength: payload.length,
    };
  }

  if (Array.isArray(payload)) {
    return {
      responseShape: "array",
      itemCount: payload.length,
    };
  }

  if (payload && typeof payload === "object") {
    return {
      responseShape: "object",
      keys: Object.keys(payload).sort(),
    };
  }

  return {
    responseShape: payload === null ? "null" : typeof payload,
  };
}

// Determines whether HTTP semantics allow a response body for this method and status.
function canResponseHaveBody(method: string, status: number) {
  return method !== "HEAD" && ![101, 103, 204, 205, 304].includes(status);
}

// Reports presence and content type of headers forwarded to a backend.
function summarizeForwardHeaders(headers: Headers) {
  return {
    hasApiKey: headers.has("apikey"),
    hasAuthorization: headers.has("authorization") || headers.has("Authorization"),
    hasGatewayAuthorization: headers.has(gatewayAuthorizationHeader),
    hasUserId: headers.has("X-User-Id"),
    hasUserType: headers.has("X-User-Type"),
    hasUserPayload: headers.has("X-User-Payload"),
    hasGatewayCaller: headers.has("x-washroom-gateway-caller"),
    hasGatewaySecret: headers.has("x-washroom-gateway-secret"),
    contentType: headers.get("content-type"),
  };
}

// Builds CORS headers using the request origin and requested header list when present.
function buildCorsHeaders(req?: Request) {
  const requestOrigin = req?.headers.get("origin");
  const requestedHeaders = req?.headers.get("access-control-request-headers");

  return {
    ...defaultCorsHeaders,
    "Access-Control-Allow-Origin": requestOrigin ?? defaultCorsHeaders["Access-Control-Allow-Origin"],
    "Access-Control-Allow-Headers": requestedHeaders ?? defaultCorsHeaders["Access-Control-Allow-Headers"],
    Vary: "Origin, Access-Control-Request-Headers",
  };
}

// Serializes a JSON gateway response with request-specific CORS headers.
function jsonResponse(status: number, body: unknown, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

// Removes the gateway function prefix to obtain the downstream route path.
function extractProxyPath(pathname: string) {
  for (const prefix of FUNCTION_PATH_PREFIXES) {
    if (!pathname.startsWith(prefix)) {
      continue;
    }

    const remainder = pathname.slice(prefix.length);
    return remainder.length > 0 ? remainder : "/";
  }

  return pathname;
}

// Finds the configured route definition matching a request path.
function matchRoute(pathname: string) {
  return supportedRoutes.find((route) => route.pattern.test(pathname));
}

// Maps an exposed proxy path to the service that should receive it.
function inferService(proxyPath: string): SERVICES | null {
  if (proxyPath.startsWith(`/${SERVICES.FRONTEND}/`)) {
    return SERVICES.FRONTEND;
  }
  if (proxyPath.startsWith(`/${SERVICES.ACCOUNTS}`)) {
    return SERVICES.ACCOUNTS;
  }

  if (proxyPath.startsWith(`/${SERVICES.ADMIN}`)) {
    return SERVICES.ADMIN;
  }

  if (proxyPath.startsWith(`/${SERVICES.PLACES}`)) {
    return SERVICES.PLACES;
  }

  if (proxyPath.startsWith(`/${SERVICES.AUTH}`)) {
    return SERVICES.AUTH;
  }

  return null;
}

// Selects the configured backend URL for the matched service.
function resolveBackendUrl(service: SERVICES | null): string | null {
  if (service === SERVICES.FRONTEND) {
    return frontendApiUrl ?? null;
  }
  if (service === SERVICES.ACCOUNTS || service === SERVICES.ADMIN) {
    return registrationApiUrl ?? null;
  }

  if (service === SERVICES.PLACES) {
    return placesApiUrl ?? null;
  }

  if (service === SERVICES.AUTH) {
    return jwtRevokeUrl ?? null;
  }

  return registrationApiUrl ?? null;
}

// Reads the incoming body when the HTTP method permits one.
async function buildForwardBody(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") {
    return null;
  }

  return await req.blob();
}

// Combines the backend base path, proxy route, and query string into the target URL.
function buildTargetUrl(baseUrl: string, proxyPath: string, search: string, service: SERVICES | null) {
  if (service === SERVICES.AUTH) {
    const targetUrl = new URL(baseUrl);
    targetUrl.search = search;
    return targetUrl;
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const parsedBaseUrl = new URL(normalizedBaseUrl);
  const baseSegments = parsedBaseUrl.pathname.split("/").filter(Boolean);
  const proxySegments = proxyPath.split("/").filter(Boolean);

  // Edge APIs serve routes at their root, without the gateway service prefix.
  if ((service === SERVICES.PLACES || service === SERVICES.FRONTEND) && proxySegments[0] === service) {
    proxySegments.shift();
  }

  const normalizedProxyPath = baseSegments.length > 0 &&
      proxySegments.length > 0 &&
      baseSegments[baseSegments.length - 1] === proxySegments[0]
    ? proxySegments.slice(1).join("/")
    : proxySegments.join("/");

  const targetUrl = new URL(normalizedProxyPath, normalizedBaseUrl);
  targetUrl.search = search;
  return targetUrl;
}

// Rewrites local hostnames to the Docker host when a backend is container-local.
function buildContainerReachableBackendUrl(baseUrl: string) {
  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") {
    return null;
  }

  parsedUrl.hostname = CONTAINER_HOSTNAME;
  return parsedUrl.toString();
}

// Builds downstream headers, including verified user metadata and gateway credentials.
function buildProxyHeaders(
  req: Request,
  service: SERVICES | null,
  verifiedToken: VerifiedToken | null,
) {
  const headers = service === SERVICES.PLACES && verifiedToken
    ? buildUserForwardHeaders(req, verifiedToken.payload, verifiedToken.tokenType)
    : new Headers(req.headers);

  headers.delete("host");
  headers.delete("content-length");

  if (service === SERVICES.AUTH) {
    const clientAuthorization = headers.get("authorization") ?? headers.get("Authorization");
    if (clientAuthorization) {
      headers.set(gatewayAuthorizationHeader, clientAuthorization);
      headers.delete("authorization");
      headers.delete("Authorization");
    }
  }

  if (
    (
      service === SERVICES.ACCOUNTS ||
      service === SERVICES.AUTH ||
      service === SERVICES.ADMIN ||
      service === SERVICES.FRONTEND ||
      service === SERVICES.PLACES
    ) &&
    gatewayInternalSecret
  ) {
    const gatewayHeaders = buildGatewayHeaders(gatewayInternalSecret);
    Object.entries(gatewayHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  return headers;
}

// Identifies the administrator login route for specialized gateway handling.
function isAdminLoginPath(proxyPath: string) {
  return proxyPath === "/admin/login";
}

// Identifies the administrator access-check route.
function isAdminAccessPath(proxyPath: string) {
  return proxyPath === "/admin/access";
}

// Identifies the administrator password-setup route.
function isAdminCreatePasswordPath(proxyPath: string) {
  return proxyPath === "/admin/create-password";
}

// Identifies the account deactivation route.
function isAccountDeactivatePath(proxyPath: string) {
  return proxyPath === "/accounts/deactivate";
}

// Identifies unauthenticated place-search routes.
function isPublicPlacesPath(proxyPath: string) {
  return /^\/places\/(bathrooms|overpass)\/?$/.test(proxyPath);
}

// Extracts the best available client IP address from proxy headers.
function getRequestIpAddress(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",");
    if (firstIp?.trim()) {
      return firstIp.trim();
    }
  }

  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  if (cfConnectingIp?.trim()) {
    return cfConnectingIp.trim();
  }

  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp?.trim()) {
    return xRealIp.trim();
  }

  return "";
}

// Verifies a Turnstile challenge when login protection is enabled.
async function verifyTurnstileChallenge(
  req: Request,
  turnstileToken: string,
) {
  if (!turnstileProtectionEnabled) {
    return null;
  }

  if (!turnstileSecretKey?.trim()) {
    return jsonResponse(503, {
      error: "Cloudflare Turnstile protection is not configured for login.",
    }, req);
  }

  if (!turnstileToken) {
    return jsonResponse(400, {
      error: "Complete the security check before signing in.",
    }, req);
  }

  const verificationBody = new URLSearchParams({
    secret: turnstileSecretKey.trim(),
    response: turnstileToken,
  });
  const remoteIp = getRequestIpAddress(req);
  if (remoteIp) {
    verificationBody.set("remoteip", remoteIp);
  }

  let verificationResponse: Response;
  try {
    verificationResponse = await fetch(turnstileVerifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: verificationBody,
    });
  } catch (error) {
    logGatewayEvent("error", "turnstile.verification.failed", {
      details: getErrorMessage(error),
    });
    return jsonResponse(502, {
      error: "Unable to verify the security check right now.",
    }, req);
  }

  const verificationPayload = await verificationResponse.json().catch(() => null) as {
    success?: boolean;
    ["error-codes"]?: string[];
  } | null;

  if (!verificationResponse.ok) {
    return jsonResponse(502, {
      error: "Unable to verify the security check right now.",
    }, req);
  }

  if (!verificationPayload?.success) {
    const errorCodes = verificationPayload?.["error-codes"] ?? [];
    const challengeExpired = errorCodes.includes("timeout-or-duplicate");
    return jsonResponse(403, {
      error: challengeExpired
        ? "The security check expired. Please try again."
        : "Security check verification failed. Please try again.",
    }, req);
  }

  return null;
}

// Returns a trimmed string field from an object, or an empty string.
function getRecordStringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

// Validates the email-only body used for administrator access checks.
function isAdminEmailRequestBody(value: unknown): value is { email: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.email === "string";
}

// Validates the email and password body used by account login routes.
function isAdminLoginRequestBody(value: unknown): value is { email: string; password: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.email === "string" && typeof record.password === "string";
}

// Reads the optional Turnstile token from a request body.
function getTurnstileToken(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  return typeof record.turnstileToken === "string" ? record.turnstileToken.trim() : "";
}

// Reuses login-body validation for administrator password setup.
function isAdminCreatePasswordRequestBody(value: unknown): value is { email: string; password: string } {
  return isAdminLoginRequestBody(value);
}

// Identifies the account login route.
function isAccountLoginPath(proxyPath: string) {
  return proxyPath === "/accounts/login";
}

// Parses a non-empty JSON body from the buffered request body.
async function parseJsonBodyFromBlob(requestBody: Blob | null) {
  if (!requestBody) {
    return null;
  }

  const text = await requestBody.text();
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text);
}

// Requests a signed custom JWT for an authenticated identity.
async function createJwtForIdentity(
  req: Request,
  identity: { userId: string; role: string },
) {
  if (!jwtCreatorUrl) {
    throw new Error("Missing JWT_CREATOR_URL environment variable.");
  }

  if (!gatewayInternalSecret) {
    throw new Error("Missing GATEWAY_INTERNAL_SECRET required for JWT creator forwarding.");
  }

  const jwtCreatorHeaders = new Headers({
    "Content-Type": "application/json",
  });
  const apiKey = req.headers.get("apikey");
  if (apiKey) {
    jwtCreatorHeaders.set("apikey", apiKey);
  }

  const gatewayHeaders = buildGatewayHeaders(gatewayInternalSecret);
  Object.entries(gatewayHeaders).forEach(([key, value]) => {
    jwtCreatorHeaders.set(key, value);
  });

  const jwtResponse = await fetch(jwtCreatorUrl, {
    method: "POST",
    headers: jwtCreatorHeaders,
    body: JSON.stringify(identity),
  });

  if (!jwtResponse.ok) {
    throw new Error(`Failed to obtain JWT from JWT_CREATOR_URL: ${jwtResponse.status} ${jwtResponse.statusText}`);
  }

  const jwtPayload = await jwtResponse.json();
  if (typeof jwtPayload !== "object" || jwtPayload === null || Array.isArray(jwtPayload)) {
    throw new Error("JWT creator returned an invalid response payload.");
  }

  const token = getRecordStringValue(jwtPayload as Record<string, unknown>, "token");
  if (!token) {
    throw new Error("JWT creator response did not include a token.");
  }

  return jwtPayload as Record<string, unknown>;
}

// Resolves an account API endpoint against the configured registration service.
function getAccountApiUrl(pathname: string) {
  if (!registrationApiUrl) {
    throw new Error("Missing WASHROOM_REGISTRATION_API_URL environment variable.");
  }

  return new URL(pathname, registrationApiUrl.endsWith("/") ? registrationApiUrl : `${registrationApiUrl}/`);
}

// Calls the registration API with optional bounded retries for transient failures.
async function fetchAccountApiResponse(
  pathname: string,
  body: Record<string, unknown>,
  options?: {
    attempts?: number;
    retryableStatusCodes?: number[];
  },
) {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (gatewayInternalSecret) {
    const gatewayHeaders = buildGatewayHeaders(gatewayInternalSecret);
    Object.entries(gatewayHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  const attempts = Math.max(1, options?.attempts ?? 1);
  const retryableStatusCodes = new Set(options?.retryableStatusCodes ?? []);
  let response: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      response = await fetch(getAccountApiUrl(pathname), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!retryableStatusCodes.has(response.status) || attempt === attempts) {
        break;
      }

      logGatewayEvent("warn", "accounts.retrying-transient-response", {
        pathname,
        attempt,
        status: response.status,
      });
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        throw error;
      }

      logGatewayEvent("warn", "accounts.retrying-transient-error", {
        pathname,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await delay(defaultRetryDelayMs * attempt);
  }

  if (!response) {
    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error(`Account request for ${pathname} failed without a response.`);
  }

  return {
    response,
    body: await response.json().catch(() => null) as unknown,
  };
}

// Extracts the email, role, and password-setup status from an account response.
function getAdminAccountResponseDetails(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const email = getRecordStringValue(record, "email");
  const role = getRecordStringValue(record, "role");
  if (!email || !role) {
    return null;
  }

  return {
    email,
    role,
    passwordSetupRequired: Boolean(record.password_setup_required),
  };
}

// Rejects account details that do not represent an administrator.
function ensureAdminAccount(details: { email: string; role: string }, req: Request) {
  if (details.role !== adminRole) {
    return jsonResponse(403, {
      error: "Only administrator accounts can access the administration app",
    }, req);
  }

  return null;
}

// Validates the email and returns the administrator's access and setup state.
async function buildAdminAccessResponse(
  req: Request,
  requestBody: Blob | null,
) {
  let parsedBody: unknown;
  try {
    parsedBody = await parseJsonBodyFromBlob(requestBody);
  } catch {
    return jsonResponse(400, {
      error: "Request body must be valid JSON",
    }, req);
  }

  if (!isAdminEmailRequestBody(parsedBody)) {
    return jsonResponse(400, {
      error: "Request body must include an email field",
    }, req);
  }

  const email = parsedBody.email.trim();
  if (!email) {
    return jsonResponse(400, {
      error: "Email is required",
    }, req);
  }

  const { response, body } = await fetchAccountApiResponse("/accounts/access", { email }, {
    attempts: 3,
    retryableStatusCodes: [500, 502, 503, 504],
  });
  if (!response.ok) {
    return jsonResponse(response.status, body ?? { error: "Failed to read account access state" }, req);
  }

  const details = getAdminAccountResponseDetails(body);
  if (!details) {
    return jsonResponse(502, {
      error: "Account access response payload is invalid",
    }, req);
  }

  const adminError = ensureAdminAccount(details, req);
  if (adminError) {
    return adminError;
  }

  return jsonResponse(200, {
    email: details.email,
    role: details.role,
    passwordSetupRequired: details.passwordSetupRequired,
  }, req);
}

// Authenticates a standard account and appends a custom token to the result.
async function buildAccountLoginResponse(
  req: Request,
  requestBody: Blob | null,
) {
  let parsedBody: unknown;
  try {
    parsedBody = await parseJsonBodyFromBlob(requestBody);
  } catch {
    return jsonResponse(400, {
      error: "Request body must be valid JSON",
    }, req);
  }

  if (!isAdminLoginRequestBody(parsedBody)) {
    return jsonResponse(400, {
      error: "Request body must include string email and password fields",
    }, req);
  }

  const email = parsedBody.email.trim();
  const password = parsedBody.password;
  if (!email || !password) {
    return jsonResponse(400, {
      error: "Email and password are required",
    }, req);
  }

  const turnstileError = await verifyTurnstileChallenge(req, getTurnstileToken(parsedBody));
  if (turnstileError) {
    return turnstileError;
  }

  const { response, body } = await fetchAccountApiResponse("/accounts/login", {
    email,
    password,
  });
  if (!response.ok) {
    return jsonResponse(response.status, body ?? { error: "Failed to authenticate account" }, req);
  }

  const payloadWithToken = await appendTokenForAccountRoutes(req, body);
  return jsonResponse(response.status, payloadWithToken, req);
}

// Authenticates an administrator and issues a JWT only after role and setup checks.
async function buildAdminLoginResponse(
  req: Request,
  requestBody: Blob | null,
) {
  let parsedBody: unknown;
  try {
    parsedBody = await parseJsonBodyFromBlob(requestBody);
  } catch {
    return jsonResponse(400, {
      error: "Request body must be valid JSON",
    }, req);
  }

  if (!isAdminLoginRequestBody(parsedBody)) {
    return jsonResponse(400, {
      error: "Request body must include string email and password fields",
    }, req);
  }

  const email = parsedBody.email.trim();
  const password = parsedBody.password;
  if (!email || !password) {
    return jsonResponse(400, {
      error: "Email and password are required",
    }, req);
  }

  const turnstileError = await verifyTurnstileChallenge(req, getTurnstileToken(parsedBody));
  if (turnstileError) {
    return turnstileError;
  }

  const { response, body } = await fetchAccountApiResponse("/accounts/login", {
    email,
    password,
  });
  if (!response.ok) {
    return jsonResponse(response.status, body ?? { error: "Failed to authenticate account" }, req);
  }

  const details = getAdminAccountResponseDetails(body);
  if (!details) {
    return jsonResponse(502, {
      error: "Account login response payload is invalid",
    }, req);
  }

  const adminError = ensureAdminAccount(details, req);
  if (adminError) {
    return adminError;
  }

  if (details.passwordSetupRequired) {
    return jsonResponse(401, {
      error: "Password setup is required for this account",
      passwordSetupRequired: true,
    }, req);
  }

  const jwtPayload = await createJwtForIdentity(req, {
    userId: details.email,
    role: details.role,
  });

  return jsonResponse(200, {
    token: getRecordStringValue(jwtPayload, "token"),
    tokenRecord: jwtPayload.tokenRecord ?? null,
    userId: details.email,
    role: details.role,
  }, req);
}

// Sets an administrator password and issues a JWT after account verification.
async function buildAdminCreatePasswordResponse(
  req: Request,
  requestBody: Blob | null,
) {
  let parsedBody: unknown;
  try {
    parsedBody = await parseJsonBodyFromBlob(requestBody);
  } catch {
    return jsonResponse(400, {
      error: "Request body must be valid JSON",
    }, req);
  }

  if (!isAdminCreatePasswordRequestBody(parsedBody)) {
    return jsonResponse(400, {
      error: "Request body must include string email and password fields",
    }, req);
  }

  const email = parsedBody.email.trim();
  const password = parsedBody.password;
  if (!email || !password) {
    return jsonResponse(400, {
      error: "Email and password are required",
    }, req);
  }

  const { response, body } = await fetchAccountApiResponse("/accounts/password/setup", {
    email,
    password,
  });
  if (!response.ok) {
    return jsonResponse(response.status, body ?? { error: "Failed to create account password" }, req);
  }

  const details = getAdminAccountResponseDetails(body);
  if (!details) {
    return jsonResponse(502, {
      error: "Password setup response payload is invalid",
    }, req);
  }

  const adminError = ensureAdminAccount(details, req);
  if (adminError) {
    return adminError;
  }

  const jwtPayload = await createJwtForIdentity(req, {
    userId: details.email,
    role: details.role,
  });

  return jsonResponse(200, {
    token: getRecordStringValue(jwtPayload, "token"),
    tokenRecord: jwtPayload.tokenRecord ?? null,
    userId: details.email,
    role: details.role,
  }, req);
}

// Revokes the user's active JWTs before asking the account service to deactivate them.
async function buildAccountDeactivateResponse(
  req: Request,
  verifiedToken: VerifiedToken | null,
) {
  if (!verifiedToken) {
    return jsonResponse(401, {
      error: "Missing verified account identity for account deactivation",
    }, req);
  }

  const accountEmail = verifiedToken?.payload && typeof verifiedToken.payload.sub === "string"
    ? verifiedToken.payload.sub.trim()
    : "";

  if (!accountEmail) {
    return jsonResponse(401, {
      error: "Authenticated account email is required for account deactivation",
    }, req);
  }

  if (!isJwtTokenDatabaseConfigured()) {
    return jsonResponse(500, {
      error: "JWT token persistence must be configured before deleting an account.",
    }, req);
  }

  await revokeJwtTokenRecordsForUser(accountEmail);

  const { response, body } = await fetchAccountApiResponse("/accounts/deactivate", {
    email: accountEmail,
  });
  if (!response.ok) {
    return jsonResponse(response.status, body ?? { error: "Failed to delete account" }, req);
  }

  return jsonResponse(200, {
    deleted: true,
    email: accountEmail,
  }, req);
}

// Forwards a request to its backend and retries local endpoints through the container host if needed.
async function fetchBackendResponse(
  req: Request,
  service: SERVICES | null,
  verifiedToken: VerifiedToken | null,
  targetUrl: URL,
  requestBody: Blob | null,
  backendBaseUrl: string,
  requestId: string,
  options?: {
    methodOverride?: string;
    proxyPathOverride?: string;
  },
) {
  const headers = buildProxyHeaders(req, service, verifiedToken);
  const method = options?.methodOverride ?? req.method;
  const proxyPath = options?.proxyPathOverride ?? extractProxyPath(new URL(req.url).pathname);

  logGatewayEvent("info", "proxy.forwarding.started", {
    requestId,
    method,
    proxyPath,
    targetUrl: targetUrl.toString(),
    ...summarizeForwardHeaders(headers),
    ...summarizeRequestBody(requestBody),
  });

  try {
    return await fetch(targetUrl, {
      method,
      headers,
      body: requestBody,
    });
  } catch (error) {
    const initialErrorMessage = getErrorMessage(error);
    const containerReachableBackendUrl = buildContainerReachableBackendUrl(backendBaseUrl);
    if (!containerReachableBackendUrl) {
      logGatewayEvent("error", "proxy.forwarding.failed", {
        requestId,
        targetUrl: targetUrl.toString(),
        usedContainerFallback: false,
        details: initialErrorMessage,
      });
      throw error;
    }

    const containerTargetUrl = buildTargetUrl(
      containerReachableBackendUrl,
      proxyPath,
      targetUrl.search,
      service,
    );

    logGatewayEvent("warn", "proxy.forwarding.retrying-with-container-host", {
      requestId,
      targetUrl: targetUrl.toString(),
      fallbackTargetUrl: containerTargetUrl.toString(),
      details: initialErrorMessage,
    });

    return await fetch(containerTargetUrl, {
      method,
      headers,
      body: requestBody,
    });
  }
}

// Decodes a backend response as JSON when possible, otherwise as text.
async function parseBackendBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  return await response.text();
}

// Detects response content types that must be relayed without parsing.
function shouldProxyRawResponseBody(contentType: string) {
  return contentType.includes("text/event-stream") ||
    contentType.startsWith("image/") ||
    contentType.includes("application/octet-stream");
}

// Summarizes a proxied response without inspecting binary or streaming content.
function summarizeProxiedBody(contentType: string, rawResponseBody: boolean, body: unknown) {
  if (rawResponseBody) {
    return {
      responseShape: contentType.includes("text/event-stream") ? "stream" : "binary",
    };
  }

  return summarizeBodyPayload(body);
}

// Preserves backend response headers and overlays gateway CORS headers.
function buildResponseHeaders(sourceHeaders: Headers, req?: Request) {
  const responseHeaders = new Headers(sourceHeaders);
  Object.entries(buildCorsHeaders(req)).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });
  return responseHeaders;
}

// Reconstructs the backend response while respecting status and body type.
function buildProxiedResponse(
  req: Request,
  status: number,
  headers: Headers,
  body: unknown,
) {
  if (!canResponseHaveBody(req.method, status)) {
    headers.delete("content-length");
    headers.delete("content-type");
    return new Response(null, {
      status,
      headers,
    });
  }

  if (typeof body === "string") {
    return new Response(body, {
      status,
      headers,
    });
  }

  if (body instanceof ReadableStream || body instanceof Uint8Array || body instanceof ArrayBuffer || body instanceof Blob) {
    return new Response(body, {
      status,
      headers,
    });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

// Adds a custom JWT to successful account responses when identity details are available.
async function appendTokenForAccountRoutes(
  req: Request,
  payload: unknown,
) {
  if (!jwtCreatorUrl || !(payload && typeof payload === "object" && !Array.isArray(payload))) {
    return payload;
  }

  const accountPayload = payload as Record<string, unknown>;
  const accountEmail = typeof accountPayload.email === "string" ? accountPayload.email.trim() : "";
  const accountRole = getRecordStringValue(accountPayload, "role") || "user";
  if (!accountEmail) {
    return payload;
  }

  const jwtPayload = await createJwtForIdentity(req, {
    userId: accountEmail,
    role: accountRole,
  });
  return {
    ...payload,
    token: getRecordStringValue(jwtPayload, "token"),
  };
}

console.log("Washroom Gateway initialized");
logGatewayEvent("info", "function.initialized", getConfiguredBackendsSummary());

export default {
  // Matches and authorizes routes, performs specialized auth flows, then proxies requests and responses.
  fetch: async (req: Request) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    logGatewayEvent("info", "request.received", buildRequestLogContext(req, requestId));

    if (req.method === "OPTIONS") {
      logGatewayEvent("info", "request.preflight", {
        requestId,
        pathname: new URL(req.url).pathname,
      });
      return new Response("ok", { headers: buildCorsHeaders(req) });
    }

    const requestUrl = new URL(req.url);
    const proxyPath = extractProxyPath(requestUrl.pathname);
    const matchedRoute = matchRoute(proxyPath);
    if (!matchedRoute) {
      logGatewayEvent("warn", "route.not-exposed", {
        requestId,
        proxyPath,
        method: req.method,
      });
      return jsonResponse(404, {
        error: `Endpoint not exposed by ${FUNCTION_NAME}`,
        path: proxyPath,
      }, req);
    }

    if (!matchedRoute.methods.includes(req.method)) {
      logGatewayEvent("warn", "route.method-not-allowed", {
        requestId,
        proxyPath,
        method: req.method,
        allowedMethods: matchedRoute.methods,
      });
      return jsonResponse(405, {
        error: "Method not allowed for endpoint",
        method: req.method,
        path: proxyPath,
      }, req);
    }

    const service = inferService(proxyPath);
    logGatewayEvent("info", "route.matched", {
      requestId,
      proxyPath,
      methods: matchedRoute.methods,
      service,
    });

    const backendBaseUrl = resolveBackendUrl(service);
    if (!backendBaseUrl) {
      logGatewayEvent("error", "backend.missing-url", {
        requestId,
        service,
        proxyPath,
      });
      return jsonResponse(500, {
        error: "Missing backend URL environment variable for requested service",
        service,
      }, req);
    }

    const requestBody = await buildForwardBody(req);
    const targetUrl = buildTargetUrl(backendBaseUrl, proxyPath, requestUrl.search, service);

    logGatewayEvent("info", "proxy.resolved", {
      requestId,
      proxyPath,
      service,
      targetUrl: targetUrl.toString(),
      ...summarizeRequestBody(requestBody),
      ...summarizeBackendUrl(backendBaseUrl),
    });

    try {
      let verifiedToken: VerifiedToken | null = null;
      if (service === SERVICES.AUTH) {
        logGatewayEvent("info", "auth.logout.requested", {
          requestId,
          proxyPath,
          targetUrl: targetUrl.toString(),
          ...getHeaderPresence(req),
        });
      }

      if (service === SERVICES.ADMIN && isAdminAccessPath(proxyPath)) {
        return await buildAdminAccessResponse(req, requestBody);
      }

      if (service === SERVICES.ACCOUNTS && isAccountLoginPath(proxyPath)) {
        return await buildAccountLoginResponse(req, requestBody);
      }

      if (service === SERVICES.ADMIN && isAdminLoginPath(proxyPath)) {
        return await buildAdminLoginResponse(req, requestBody);
      }

      if (service === SERVICES.ADMIN && isAdminCreatePasswordPath(proxyPath)) {
        return await buildAdminCreatePasswordResponse(req, requestBody);
      }

      if (
        (service === SERVICES.ACCOUNTS && isAccountDeactivatePath(proxyPath)) ||
        (service === SERVICES.PLACES && !isPublicPlacesPath(proxyPath))
      ) {
        logGatewayEvent("info", "token.validation.started", {
          requestId,
          proxyPath,
          ...getHeaderPresence(req),
        });

        const validationResult = await verifyTokenWithValidator(req, jsonResponse);
        const { errorResponse } = validationResult;
        if (errorResponse) {
          logGatewayEvent("warn", "token.validation.failed", {
            requestId,
            proxyPath,
          });
          return errorResponse;
        }

        verifiedToken = validationResult.verifiedToken;
        logGatewayEvent("info", "token.validation.succeeded", {
          requestId,
          proxyPath,
          tokenType: verifiedToken?.tokenType ?? null,
          hasSubject: Boolean(
            verifiedToken?.payload &&
              typeof verifiedToken.payload.sub === "string" &&
              verifiedToken.payload.sub.length > 0,
          ),
        });
      }

      if (service === SERVICES.ACCOUNTS && isAccountDeactivatePath(proxyPath)) {
        return await buildAccountDeactivateResponse(req, verifiedToken);
      }

      const backendResponse = await fetchBackendResponse(
        req,
        service,
        verifiedToken,
        targetUrl,
        requestBody,
        backendBaseUrl,
        requestId,
      );

      if (service === SERVICES.AUTH) {
        logGatewayEvent("info", "auth.logout.forwarded", {
          requestId,
          proxyPath,
          targetUrl: targetUrl.toString(),
          status: backendResponse.status,
          ok: backendResponse.ok,
        });
      }

      const responseHeaders = buildResponseHeaders(backendResponse.headers, req);
      const responseContentType = backendResponse.headers.get("content-type") ?? "";
      const proxyRawResponseBody = canResponseHaveBody(req.method, backendResponse.status) &&
        shouldProxyRawResponseBody(responseContentType);
      const responseBody = canResponseHaveBody(req.method, backendResponse.status)
        ? proxyRawResponseBody
          ? backendResponse.body
          : await parseBackendBody(backendResponse)
        : null;

      if (service === SERVICES.AUTH) {
        logGatewayEvent(backendResponse.ok ? "info" : "warn", "auth.logout.response", {
          requestId,
          proxyPath,
          status: backendResponse.status,
          ok: backendResponse.ok,
          ...summarizeProxiedBody(responseContentType, proxyRawResponseBody, responseBody),
          responseBody,
        });
      }

      logGatewayEvent("info", "proxy.completed", {
        requestId,
        proxyPath,
        service,
        status: backendResponse.status,
        ok: backendResponse.ok,
        contentType: responseContentType,
        responseContentLength: backendResponse.headers.get("content-length"),
        ...summarizeProxiedBody(responseContentType, proxyRawResponseBody, responseBody),
        durationMs: Date.now() - startedAt,
      });

      if (service === SERVICES.ACCOUNTS && backendResponse.ok) {
        const payloadWithToken = await appendTokenForAccountRoutes(req, responseBody);

        logGatewayEvent("info", "accounts.token-appended", {
          requestId,
          proxyPath,
          tokenAdded: payloadWithToken !== responseBody,
          ...summarizeBodyPayload(payloadWithToken),
        });

        return buildProxiedResponse(
          req,
          backendResponse.status,
          responseHeaders,
          payloadWithToken,
        );
      }

      return buildProxiedResponse(
        req,
        backendResponse.status,
        responseHeaders,
        responseBody,
      );
    } catch (error) {
      const message = getErrorMessage(error);
      logGatewayEvent("error", "proxy.failed", {
        requestId,
        proxyPath,
        service,
        durationMs: Date.now() - startedAt,
        details: message,
      });
      return jsonResponse(502, {
        error: "Gateway failed to reach destination server",
        details: message,
      }, req);
    }
  },
};
