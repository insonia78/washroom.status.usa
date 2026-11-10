import { gatewayAuthorizationHeader } from "../_shared/gateway-auth.ts";
import {
  frontendApiUrl,
  FUNCTION_NAME,
  gatewayInternalSecret,
  jwtCreatorUrl,
  jwtRevokeUrl,
  placesApiUrl,
  registrationApiUrl,
} from "./config.ts";

export type LogLevel = "info" | "warn" | "error";

// Emits a structured gateway log entry at the requested severity.
export function logGatewayEvent(
  level: LogLevel,
  event: string,
  details: Record<string, unknown> = {},
) {
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

// Reports only whether key request headers are present, not their values.
export function getHeaderPresence(req: Request) {
  return {
    hasApiKey: Boolean(req.headers.get("apikey")),
    hasAuthorization: Boolean(
      req.headers.get("authorization") ?? req.headers.get("Authorization"),
    ),
    hasGatewayAuthorization: Boolean(
      req.headers.get(gatewayAuthorizationHeader),
    ),
    hasGatewayCaller: Boolean(req.headers.get("x-washroom-gateway-caller")),
    hasGatewaySecret: Boolean(req.headers.get("x-washroom-gateway-secret")),
  };
}

// Collects request metadata used by gateway logs.
export function buildRequestLogContext(req: Request, requestId: string) {
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
export function summarizeBackendUrl(baseUrl: string) {
  const parsedUrl = new URL(baseUrl);

  return {
    backendOrigin: parsedUrl.origin,
    backendPathname: parsedUrl.pathname,
  };
}

// Converts unknown thrown values into readable error text.
export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Summarizes configured backend URLs and secret presence for startup logging.
export function getConfiguredBackendsSummary() {
  return {
    hasRegistrationApiUrl: Boolean(registrationApiUrl),
    hasPlacesApiUrl: Boolean(placesApiUrl),
    hasFrontendApiUrl: Boolean(frontendApiUrl),
    hasJwtCreatorUrl: Boolean(jwtCreatorUrl),
    hasJwtRevokeUrl: Boolean(jwtRevokeUrl),
    hasGatewayInternalSecret: Boolean(gatewayInternalSecret),
    registrationBackend: registrationApiUrl
      ? summarizeBackendUrl(registrationApiUrl)
      : null,
    placesBackend: placesApiUrl ? summarizeBackendUrl(placesApiUrl) : null,
    jwtRevokeBackend: jwtRevokeUrl ? summarizeBackendUrl(jwtRevokeUrl) : null,
  };
}

// Reports whether a forwarded request body exists and its size and content type.
export function summarizeRequestBody(requestBody: Blob | null) {
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
export function summarizeBodyPayload(payload: unknown) {
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

// Reports presence and content type of headers forwarded to a backend.
export function summarizeForwardHeaders(headers: Headers) {
  return {
    hasApiKey: headers.has("apikey"),
    hasAuthorization: headers.has("authorization") ||
      headers.has("Authorization"),
    hasGatewayAuthorization: headers.has(gatewayAuthorizationHeader),
    hasUserId: headers.has("X-User-Id"),
    hasUserType: headers.has("X-User-Type"),
    hasUserPayload: headers.has("X-User-Payload"),
    hasGatewayCaller: headers.has("x-washroom-gateway-caller"),
    hasGatewaySecret: headers.has("x-washroom-gateway-secret"),
    contentType: headers.get("content-type"),
  };
}
