// import "@supabase/functions-js/edge-runtime.d.ts";
import { jwtVerify } from "npm:jose@5";
import {
  isJwtTokenDatabaseConfigured,
  jwtTokenDatabaseUrlEnvVar,
  revokeJwtTokenRecord,
} from "../_shared/jwt-token-store.ts";
import {
  authorizeGatewayRequest,
  gatewayAuthorizationHeader,
  gatewayCallerHeader,
  gatewaySecretHeader,
} from "../_shared/gateway-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    `authorization, x-client-info, apikey, content-type, ${gatewayCallerHeader}, ${gatewaySecretHeader}, ${gatewayAuthorizationHeader}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const customJwtSecret = Deno.env.get("MY_JWT_SECRET") ?? Deno.env.get("CUSTOM_JWT_SECRET");
const encoder = new TextEncoder();

type RevokeTokenRequestBody = {
  tokenId?: string;
};

// Serializes revocation responses with the required CORS headers.
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Writes structured events for token-revocation requests.
function logRevokeEvent(event: string, details: Record<string, unknown> = {}) {
  console.log(`[jwt-revoke] ${JSON.stringify({
    event,
    functionName: "jwt-revoke",
    ...details,
  })}`);
}

// Validates the optional token ID accepted in the revocation request.
function isRevokeTokenRequestBody(value: unknown): value is RevokeTokenRequestBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.tokenId === "undefined" || typeof candidate.tokenId === "string";
}

// Finds a bearer token in the gateway-forwarded or standard authorization header.
function getBearerAuthorization(req: Request) {
  const gatewayAuthorization = req.headers.get(gatewayAuthorizationHeader);
  if (gatewayAuthorization?.startsWith("Bearer ")) {
    return {
      value: gatewayAuthorization,
      source: gatewayAuthorizationHeader,
    };
  }

  const requestAuthorization = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (requestAuthorization?.startsWith("Bearer ")) {
    return {
      value: requestAuthorization,
      source: "authorization",
    };
  }

  return null;
}

// Verifies the bearer JWT and extracts its token ID for revocation.
async function getTokenIdFromBearerToken(req: Request): Promise<string | null> {
  const bearerAuthorization = getBearerAuthorization(req);
  if (!bearerAuthorization) {
    logRevokeEvent("authorization.missing-bearer", {
      checkedHeaders: [gatewayAuthorizationHeader, "authorization"],
    });
    return null;
  }

  if (!customJwtSecret) {
    throw new Error("Missing MY_JWT_SECRET or CUSTOM_JWT_SECRET environment variable.");
  }

  const token = bearerAuthorization.value.slice("Bearer ".length);
  const verified = await jwtVerify(token, encoder.encode(customJwtSecret));
  const tokenId = verified.payload.jti;
  logRevokeEvent("authorization.verified", {
    source: bearerAuthorization.source,
    hasTokenId: typeof tokenId === "string" && tokenId.trim().length > 0,
    subject: typeof verified.payload.sub === "string" ? verified.payload.sub : null,
  });
  return typeof tokenId === "string" && tokenId.trim() ? tokenId : null;
}

export default {
  // Checks gateway access and revokes the specified token or the caller's token.
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders,
      });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, {
        error: "Method not allowed",
        method: req.method,
      });
    }

    const gatewayAuthorizationError = authorizeGatewayRequest(req, jsonResponse, "jwt-revoke");
    if (gatewayAuthorizationError) {
      logRevokeEvent("gateway.authorization.failed");
      return gatewayAuthorizationError;
    }

    if (!isJwtTokenDatabaseConfigured()) {
      logRevokeEvent("database.configuration.missing", {
        envVar: jwtTokenDatabaseUrlEnvVar,
      });
      return jsonResponse(500, {
        error: `Missing ${jwtTokenDatabaseUrlEnvVar} environment variable`,
      });
    }

    try {
      const requestBody = await req.json();
      if (!isRevokeTokenRequestBody(requestBody)) {
        return jsonResponse(400, {
          error: "Request body must be a JSON object with an optional string tokenId field.",
        });
      }

      const explicitTokenId = typeof requestBody.tokenId === "string" ? requestBody.tokenId.trim() : "";
      const tokenId = explicitTokenId || await getTokenIdFromBearerToken(req);
      logRevokeEvent("token.resolution.completed", {
        usedExplicitTokenId: Boolean(explicitTokenId),
        tokenId,
      });

      if (!tokenId) {
        return jsonResponse(400, {
          error: "Provide tokenId in the request body or a valid bearer token forwarded by gateway.",
        });
      }

      const revokedToken = await revokeJwtTokenRecord(tokenId);
      logRevokeEvent("database.revoke.completed", {
        tokenId,
        revoked: Boolean(revokedToken),
        revokedAt: revokedToken?.revokedAt ?? null,
      });

      if (!revokedToken) {
        return jsonResponse(404, {
          error: "JWT token record was not found or has already been revoked.",
        });
      }

      return jsonResponse(200, {
        revoked: true,
        tokenId: revokedToken.tokenId,
        revokedAt: revokedToken.revokedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logRevokeEvent("request.failed", {
        error: message,
      });
      return jsonResponse(400, {
        error: message,
      });
    }
  },
}; /* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Call this function through gateway with GATEWAY_INTERNAL_SECRET configured.

*/
