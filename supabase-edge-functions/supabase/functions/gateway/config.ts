import { gatewayAuthorizationHeader } from "../_shared/gateway-auth.ts";

export const defaultCorsHeaders = {
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
    "x-washroom-client-ip",
    gatewayAuthorizationHeader,
  ].join(", "),
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

export const FUNCTION_NAME = "gateway";
export const FUNCTION_BASE_PATH = `/functions/v1/${FUNCTION_NAME}`;
export const FUNCTION_PATH_PREFIXES = [FUNCTION_BASE_PATH, `/${FUNCTION_NAME}`];
export const registrationApiUrl = Deno.env.get("WASHROOM_REGISTRATION_API_URL");
export const turnstileProtectionEnabled = false;
export const turnstileSecretKey = Deno.env.get("TURNSTILE_SECRET_KEY");
export const turnstileVerifyUrl = Deno.env.get("TURNSTILE_VERIFY_URL") ??
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const jwtCreatorUrl = Deno.env.get("JWT_CREATOR_URL");
export const jwtValidatorUrl = Deno.env.get("JWT_VALIDATOR_URL");
export const gatewayInternalSecret = Deno.env.get("GATEWAY_INTERNAL_SECRET");
export const CONTAINER_HOSTNAME = "host.docker.internal";
export const adminRole = "admin";
export const defaultRetryDelayMs = 250;

// Derives a sibling edge-function URL by replacing the final path segment.
export function deriveSiblingFunctionUrl(
  functionUrl: string | undefined,
  functionName: string,
): string | null {
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

export const jwtRevokeUrl = Deno.env.get("JWT_REVOKE_URL") ??
  deriveSiblingFunctionUrl(jwtCreatorUrl, "jwt-revoke") ??
  deriveSiblingFunctionUrl(jwtValidatorUrl, "jwt-revoke");
export const placesApiUrl = Deno.env.get("PLACES_API_URL") ??
  deriveSiblingFunctionUrl(jwtCreatorUrl, "places-api") ??
  deriveSiblingFunctionUrl(jwtValidatorUrl, "places-api");
export const frontendApiUrl = Deno.env.get("FRONTEND_API_URL") ??
  deriveSiblingFunctionUrl(placesApiUrl ?? undefined, "frontend-api");
