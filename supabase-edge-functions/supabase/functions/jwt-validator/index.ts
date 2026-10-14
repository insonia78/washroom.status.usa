// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.
// Setup type definitions for built-in Supabase Runtime APIs
// import "@supabase/functions-js/edge-runtime.d.ts";
import { jwtVerify } from "npm:jose@5";
import {
  findJwtTokenRecordById,
  isJwtTokenDatabaseConfigured,
  jwtTokenDatabaseUrlEnvVar,
} from "../_shared/jwt-token-store.ts";
import { authorizeWeatherGatewayRequest, weatherGatewayCallerHeader, weatherGatewaySecretHeader } from "../_shared/weather-gateway-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": `authorization, x-client-info, apikey, content-type, ${weatherGatewayCallerHeader}, ${weatherGatewaySecretHeader}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseJwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
const customJwtSecret = Deno.env.get("MY_JWT_SECRET") ?? Deno.env.get("CUSTOM_JWT_SECRET");
const encoder = new TextEncoder();

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function getPayloadStringValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function getPayloadNumberValue(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type VerifiedToken = {
  payload: Record<string, unknown>;
  tokenType: "supabase" | "custom";
};

type CustomTokenDatabaseValidationResult =
  | { valid: true }
  | { valid: false; status: number; error: string };

async function verifyToken(token: string): Promise<VerifiedToken | null> {
  if (supabaseJwtSecret) {
    try {
      const verified = await jwtVerify(token, encoder.encode(supabaseJwtSecret));
      return {
        payload: verified.payload,
        tokenType: "supabase"
      };
    } catch  {
    // Try the custom JWT secret next.
    }
  }
  if (customJwtSecret) {
    try {
      const verified = await jwtVerify(token, encoder.encode(customJwtSecret));
      return {
        payload: verified.payload,
        tokenType: "custom"
      };
    } catch  {
    // Both configured validations failed.
    }
  }
  return null;
}

async function validateCustomTokenAgainstDatabase(
  payload: Record<string, unknown>,
): Promise<CustomTokenDatabaseValidationResult> {
  if (!isJwtTokenDatabaseConfigured()) {
    return {
      valid: false,
      status: 500,
      error: `Missing ${jwtTokenDatabaseUrlEnvVar} environment variable for custom JWT validation`,
    };
  }

  const tokenId = getPayloadStringValue(payload, "jti");
  const tokenSha = getPayloadStringValue(payload, "sha");
  const userId = getPayloadStringValue(payload, "sub");
  const role = getPayloadStringValue(payload, "role");
  const issuer = getPayloadStringValue(payload, "iss");
  const issuedAt = getPayloadNumberValue(payload, "iat");
  const expiresAt = getPayloadNumberValue(payload, "exp");

  if (!tokenId || !tokenSha || !userId || !role || !issuer || issuedAt === null || expiresAt === null) {
    return {
      valid: false,
      status: 401,
      error: "Custom JWT is missing required claims for database validation",
    };
  }

  const tokenRecord = await findJwtTokenRecordById(tokenId);
  if (!tokenRecord) {
    return {
      valid: false,
      status: 401,
      error: "Custom JWT token record was not found",
    };
  }

  if (tokenRecord.revokedAt !== null) {
    return {
      valid: false,
      status: 401,
      error: "Custom JWT has been revoked",
    };
  }

  if (tokenRecord.expiresAt <= Math.floor(Date.now() / 1000)) {
    return {
      valid: false,
      status: 401,
      error: "Custom JWT token record has expired",
    };
  }

  if (
    tokenRecord.tokenSha !== tokenSha ||
    tokenRecord.userId !== userId ||
    tokenRecord.role !== role ||
    tokenRecord.issuer !== issuer ||
    tokenRecord.issuedAt !== issuedAt ||
    tokenRecord.expiresAt !== expiresAt
  ) {
    return {
      valid: false,
      status: 401,
      error: "Custom JWT does not match the persisted token record",
    };
  }

  return { valid: true };
}

// This endpoint uses 'publishable' | 'secret' access, apiKey is required.
// Use publishable for client-facing, key-validated endpoints.
// Use secret for server-to-server, internal calls.
export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders
      });
    }
    if (req.method !== "POST") {
      return jsonResponse(405, {
        error: "Method not allowed",
        method: req.method
      });
    }
    const gatewayAuthorizationError = authorizeWeatherGatewayRequest(req, jsonResponse, "jwt-validator");
    if (gatewayAuthorizationError) {
      return gatewayAuthorizationError;
    }
    if (!supabaseJwtSecret && !customJwtSecret) {
      return jsonResponse(500, {
        error: "Missing JWT verification secret configuration"
      });
    }
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(401, {
        error: "Missing or invalid Authorization header"
      });
    }
    const token = authHeader.slice("Bearer ".length);
    const verifiedToken = await verifyToken(token);
    if (!verifiedToken) {
      return jsonResponse(401, {
        error: "Invalid or expired token"
      });
    }

    if (verifiedToken.tokenType === "custom") {
      const databaseValidation = await validateCustomTokenAgainstDatabase(verifiedToken.payload);
      if (!databaseValidation.valid) {
        return jsonResponse(databaseValidation.status, {
          error: databaseValidation.error
        });
      }
    }

    return jsonResponse(200, {
      payload: verifiedToken.payload,
      tokenType: verifiedToken.tokenType,
      databaseValidated: verifiedToken.tokenType === "custom",
      userId: getPayloadStringValue(verifiedToken.payload, "sub"),
      userEmail: getPayloadStringValue(verifiedToken.payload, "email")
    });
  }
}; /* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Call this function through weather-gateway with WEATHER_GATEWAY_INTERNAL_SECRET configured.

*/ 
