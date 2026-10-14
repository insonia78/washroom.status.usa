// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.
// Setup type definitions for built-in Supabase Runtime APIs
// import "@supabase/functions-js/edge-runtime.d.ts";

import {
  buildWeatherGatewayHeaders,
  weatherGatewayAuthorizationHeader,
} from "../_shared/weather-gateway-auth.ts";
import {
  isJwtTokenDatabaseConfigured,
  revokeJwtTokenRecordsForUser,
} from "../_shared/jwt-token-store.ts";
import { buildForwardHeaders as buildWeatherForwardHeaders } from "./build-forward-headers.ts";
import { SERVICES } from "./models.ts";
import { supportedRoutes } from "./supported-routes.ts";
import type { VerifiedToken } from "./utils.ts";
import { verifyTokenWithValidator } from "./verify-token-validator.ts";

console.log("Weather Gateway init");

const defaultCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": [
    "authorization",
    "x-client-info",
    "apikey",
    "content-type",
    "accept",
    "origin",
    "x-weather-gateway-caller",
    "x-weather-gateway-secret",
    weatherGatewayAuthorizationHeader,
  ].join(", "),
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const FUNCTION_NAME = "weather-gateway";
const FUNCTION_BASE_PATH = `/functions/v1/${FUNCTION_NAME}`;
const FUNCTION_PATH_PREFIXES = [FUNCTION_BASE_PATH, `/${FUNCTION_NAME}`];
const registrationApiUrl =
  Deno.env.get("WEATHER_REGISTRATION_API_URL") ??
  Deno.env.get("REGISTRATION_API_URL");
const weatherApiUrl =
  Deno.env.get("WEATHER_API_URL") ??
  Deno.env.get("NEST_WEATHER_API_URL") ??
  Deno.env.get("BACKEND_URL");
const turnstileProtectionEnabled = false;
const turnstileSecretKey = Deno.env.get("TURNSTILE_SECRET_KEY");
const turnstileVerifyUrl = Deno.env.get("TURNSTILE_VERIFY_URL") ??
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const jwtCreatorUrl = Deno.env.get("JWT_CREATOR_URL");
const jwtValidatorUrl = Deno.env.get("JWT_VALIDATOR_URL");
const gatewayInternalSecret = Deno.env.get("WEATHER_GATEWAY_INTERNAL_SECRET");
const CONTAINER_HOSTNAME = "host.docker.internal";
const adminRole = "admin";
const defaultRetryDelayMs = 250;

type LogLevel = "info" | "warn" | "error";

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

function logGatewayEvent(level: LogLevel, event: string, details: Record<string, unknown> = {}) {
  const payload = {
    event,
    functionName: FUNCTION_NAME,
    ...details,
  };
  const message = `[weather-gateway] ${JSON.stringify(payload)}`;

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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHeaderPresence(req: Request) {
  return {
    hasApiKey: Boolean(req.headers.get("apikey")),
    hasAuthorization: Boolean(req.headers.get("authorization") ?? req.headers.get("Authorization")),
    hasGatewayAuthorization: Boolean(req.headers.get(weatherGatewayAuthorizationHeader)),
    hasGatewayCaller: Boolean(req.headers.get("x-weather-gateway-caller")),
    hasGatewaySecret: Boolean(req.headers.get("x-weather-gateway-secret")),
  };
}

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

function summarizeBackendUrl(baseUrl: string) {
  const parsedUrl = new URL(baseUrl);

  return {
    backendOrigin: parsedUrl.origin,
    backendPathname: parsedUrl.pathname,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getConfiguredBackendsSummary() {
  return {
    hasRegistrationApiUrl: Boolean(registrationApiUrl),
    hasWeatherApiUrl: Boolean(weatherApiUrl),
    hasJwtCreatorUrl: Boolean(jwtCreatorUrl),
    hasJwtRevokeUrl: Boolean(jwtRevokeUrl),
    hasGatewayInternalSecret: Boolean(gatewayInternalSecret),
    registrationBackend: registrationApiUrl ? summarizeBackendUrl(registrationApiUrl) : null,
    weatherBackend: weatherApiUrl ? summarizeBackendUrl(weatherApiUrl) : null,
    jwtRevokeBackend: jwtRevokeUrl ? summarizeBackendUrl(jwtRevokeUrl) : null,
  };
}

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

function canResponseHaveBody(method: string, status: number) {
  return method !== "HEAD" && ![101, 103, 204, 205, 304].includes(status);
}

function summarizeForwardHeaders(headers: Headers) {
  return {
    hasApiKey: headers.has("apikey"),
    hasAuthorization: headers.has("authorization") || headers.has("Authorization"),
    hasGatewayAuthorization: headers.has(weatherGatewayAuthorizationHeader),
    hasUserId: headers.has("X-User-Id"),
    hasUserType: headers.has("X-User-Type"),
    hasUserPayload: headers.has("X-User-Payload"),
    hasGatewayCaller: headers.has("x-weather-gateway-caller"),
    hasGatewaySecret: headers.has("x-weather-gateway-secret"),
    contentType: headers.get("content-type"),
  };
}

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

function jsonResponse(status: number, body: unknown, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

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

function matchRoute(pathname: string) {
  return supportedRoutes.find((route) => route.pattern.test(pathname));
}

function inferService(proxyPath: string): SERVICES | null {
  if (proxyPath.startsWith(`/${SERVICES.ACCOUNTS}`)) {
    return SERVICES.ACCOUNTS;
  }

  if (proxyPath.startsWith(`/${SERVICES.ADMIN}`)) {
    return SERVICES.ADMIN;
  }

  if (proxyPath.startsWith(`/${SERVICES.WEATHER}`)) {
    return SERVICES.WEATHER;
  }

  if (proxyPath.startsWith(`/${SERVICES.AUTH}`)) {
    return SERVICES.AUTH;
  }

  return null;
}

function resolveBackendUrl(service: SERVICES | null): string | null {
  if (service === SERVICES.ACCOUNTS) {
    return registrationApiUrl ?? null;
  }

  if (service === SERVICES.ADMIN) {
    return weatherApiUrl ?? null;
  }

  if (service === SERVICES.WEATHER) {
    return weatherApiUrl ?? null;
  }

  if (service === SERVICES.AUTH) {
    return jwtRevokeUrl ?? null;
  }

  return registrationApiUrl ?? weatherApiUrl ?? null;
}

async function buildForwardBody(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") {
    return null;
  }

  return await req.blob();
}

function buildTargetUrl(baseUrl: string, proxyPath: string, search: string, service: SERVICES | null) {
  if (service === SERVICES.AUTH) {
    const targetUrl = new URL(baseUrl);
    targetUrl.search = search;
    return targetUrl;
  }

  const normalizedBaseUrl = normalizeBackendBaseUrl(baseUrl, service);
  const parsedBaseUrl = new URL(normalizedBaseUrl);
  const baseSegments = parsedBaseUrl.pathname.split("/").filter(Boolean);
  const proxySegments = proxyPath.split("/").filter(Boolean);

  const normalizedProxyPath = baseSegments.length > 0 &&
      proxySegments.length > 0 &&
      baseSegments[baseSegments.length - 1] === proxySegments[0]
    ? proxySegments.slice(1).join("/")
    : proxySegments.join("/");

  const targetUrl = new URL(normalizedProxyPath, normalizedBaseUrl);
  targetUrl.search = search;
  return targetUrl;
}

function normalizeBackendBaseUrl(baseUrl: string, service: SERVICES | null) {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  if (service !== SERVICES.ADMIN) {
    return normalizedBaseUrl;
  }

  const parsedBaseUrl = new URL(normalizedBaseUrl);
  const baseSegments = parsedBaseUrl.pathname.split("/").filter(Boolean);
  if (baseSegments[baseSegments.length - 1] !== SERVICES.WEATHER) {
    return normalizedBaseUrl;
  }

  baseSegments.pop();
  parsedBaseUrl.pathname = baseSegments.length > 0 ? `/${baseSegments.join("/")}/` : "/";
  return parsedBaseUrl.toString();
}

function buildContainerReachableBackendUrl(baseUrl: string) {
  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") {
    return null;
  }

  parsedUrl.hostname = CONTAINER_HOSTNAME;
  return parsedUrl.toString();
}

function buildProxyHeaders(
  req: Request,
  service: SERVICES | null,
  verifiedToken: VerifiedToken | null,
) {
  const headers = (service === SERVICES.WEATHER || service === SERVICES.ADMIN) && verifiedToken
    ? buildWeatherForwardHeaders(req, verifiedToken.payload, verifiedToken.tokenType)
    : new Headers(req.headers);

  headers.delete("host");
  headers.delete("content-length");

  if (service === SERVICES.AUTH) {
    const clientAuthorization = headers.get("authorization") ?? headers.get("Authorization");
    if (clientAuthorization) {
      headers.set(weatherGatewayAuthorizationHeader, clientAuthorization);
      headers.delete("authorization");
      headers.delete("Authorization");
    }
  }

  if (
    (
      service === SERVICES.ACCOUNTS ||
      service === SERVICES.AUTH ||
      service === SERVICES.ADMIN ||
      service === SERVICES.WEATHER
    ) &&
    gatewayInternalSecret
  ) {
    const gatewayHeaders = buildWeatherGatewayHeaders(gatewayInternalSecret);
    Object.entries(gatewayHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function isAdminLoginPath(proxyPath: string) {
  return proxyPath === "/admin/login";
}

function isAdminAccessPath(proxyPath: string) {
  return proxyPath === "/admin/access";
}

function isAdminCreatePasswordPath(proxyPath: string) {
  return proxyPath === "/admin/create-password";
}

function isAccountDeactivatePath(proxyPath: string) {
  return proxyPath === "/accounts/deactivate";
}

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

function isAdminDashboardPath(proxyPath: string) {
  return proxyPath === "/admin/dashboard";
}

function isAdminDashboardStreamPath(proxyPath: string) {
  return proxyPath === "/admin/dashboard/stream";
}

function isPublicWeatherMapLayerPath(proxyPath: string) {
  return /^\/weather\/map-layers\/(clouds_new|precipitation_new|temp_new|wind_new)\/\d+\/\d+\/\d+\/?$/.test(proxyPath);
}

function getRecordStringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function isAdminEmailRequestBody(value: unknown): value is { email: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.email === "string";
}

function isAdminLoginRequestBody(value: unknown): value is { email: string; password: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.email === "string" && typeof record.password === "string";
}

function getTurnstileToken(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  return typeof record.turnstileToken === "string" ? record.turnstileToken.trim() : "";
}

function isAdminCreatePasswordRequestBody(value: unknown): value is { email: string; password: string } {
  return isAdminLoginRequestBody(value);
}

function isAccountLoginPath(proxyPath: string) {
  return proxyPath === "/accounts/login";
}

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

async function createJwtForIdentity(
  req: Request,
  identity: { userId: string; role: string },
) {
  if (!jwtCreatorUrl) {
    throw new Error("Missing JWT_CREATOR_URL environment variable.");
  }

  if (!gatewayInternalSecret) {
    throw new Error("Missing WEATHER_GATEWAY_INTERNAL_SECRET required for JWT creator forwarding.");
  }

  const jwtCreatorHeaders = new Headers({
    "Content-Type": "application/json",
  });
  const apiKey = req.headers.get("apikey");
  if (apiKey) {
    jwtCreatorHeaders.set("apikey", apiKey);
  }

  const gatewayHeaders = buildWeatherGatewayHeaders(gatewayInternalSecret);
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

function getAccountApiUrl(pathname: string) {
  if (!registrationApiUrl) {
    throw new Error("Missing WEATHER_REGISTRATION_API_URL environment variable.");
  }

  return new URL(pathname, registrationApiUrl.endsWith("/") ? registrationApiUrl : `${registrationApiUrl}/`);
}

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
    const gatewayHeaders = buildWeatherGatewayHeaders(gatewayInternalSecret);
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

function ensureAdminAccount(details: { email: string; role: string }, req: Request) {
  if (details.role !== adminRole) {
    return jsonResponse(403, {
      error: "Only administrator accounts can access the administration app",
    }, req);
  }

  return null;
}

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

async function cleanupWeatherAccountData(
  req: Request,
  verifiedToken: VerifiedToken,
  requestId: string,
) {
  if (!weatherApiUrl) {
    throw new Error("Missing WEATHER_API_URL environment variable.");
  }

  const targetUrl = buildTargetUrl(weatherApiUrl, "/weather/profile", "", SERVICES.WEATHER);
  const response = await fetchBackendResponse(
    req,
    SERVICES.WEATHER,
    verifiedToken,
    targetUrl,
    null,
    weatherApiUrl,
    requestId,
    {
      methodOverride: "DELETE",
      proxyPathOverride: "/weather/profile",
    },
  );

  if (!response.ok) {
    const body = await parseBackendBody(response);
    return {
      ok: false,
      errorResponse: jsonResponse(
        response.status,
        body ?? { error: "Failed to delete persisted weather account data" },
        req,
      ),
    };
  }

  return {
    ok: true,
    errorResponse: null,
  };
}

async function buildAccountDeactivateResponse(
  req: Request,
  verifiedToken: VerifiedToken | null,
  requestId: string,
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

  const weatherCleanup = await cleanupWeatherAccountData(req, verifiedToken, requestId);
  if (!weatherCleanup.ok) {
    return weatherCleanup.errorResponse;
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

function authorizeAdminToken(
  req: Request,
  verifiedToken: VerifiedToken | null,
) {
  const role = verifiedToken?.payload && typeof verifiedToken.payload.role === "string"
    ? verifiedToken.payload.role.trim()
    : "";

  if (role !== adminRole) {
    return jsonResponse(403, {
      error: "Admin role is required for this route",
    }, req);
  }

  return null;
}

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

async function parseBackendBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  return await response.text();
}

function shouldProxyRawResponseBody(contentType: string) {
  return contentType.includes("text/event-stream") ||
    contentType.startsWith("image/") ||
    contentType.includes("application/octet-stream");
}

function summarizeProxiedBody(contentType: string, rawResponseBody: boolean, body: unknown) {
  if (rawResponseBody) {
    return {
      responseShape: contentType.includes("text/event-stream") ? "stream" : "binary",
    };
  }

  return summarizeBodyPayload(body);
}

function buildResponseHeaders(sourceHeaders: Headers, req?: Request) {
  const responseHeaders = new Headers(sourceHeaders);
  Object.entries(buildCorsHeaders(req)).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });
  return responseHeaders;
}

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

console.log("Weather Gateway initialized");
logGatewayEvent("info", "function.initialized", getConfiguredBackendsSummary());

export default {
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
        error: "Endpoint not exposed by weather-gateway",
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
        (service === SERVICES.WEATHER && !isPublicWeatherMapLayerPath(proxyPath)) ||
        (service === SERVICES.ADMIN && (isAdminDashboardPath(proxyPath) || isAdminDashboardStreamPath(proxyPath)))
      ) {
        logGatewayEvent("info", "weather.validation.started", {
          requestId,
          proxyPath,
          ...getHeaderPresence(req),
        });

        const validationResult = await verifyTokenWithValidator(req, jsonResponse);
        const { errorResponse } = validationResult;
        if (errorResponse) {
          logGatewayEvent("warn", "weather.validation.failed", {
            requestId,
            proxyPath,
          });
          return errorResponse;
        }

        verifiedToken = validationResult.verifiedToken;
        logGatewayEvent("info", "weather.validation.succeeded", {
          requestId,
          proxyPath,
          tokenType: verifiedToken?.tokenType ?? null,
          hasSubject: Boolean(
            verifiedToken?.payload &&
              typeof verifiedToken.payload.sub === "string" &&
              verifiedToken.payload.sub.length > 0,
          ),
        });

        if (service === SERVICES.ADMIN) {
          const adminRoleError = authorizeAdminToken(req, verifiedToken);
          if (adminRoleError) {
            logGatewayEvent("warn", "admin.validation.failed", {
              requestId,
              proxyPath,
            });
            return adminRoleError;
          }
        }
      }

      if (service === SERVICES.ACCOUNTS && isAccountDeactivatePath(proxyPath)) {
        return await buildAccountDeactivateResponse(req, verifiedToken, requestId);
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
