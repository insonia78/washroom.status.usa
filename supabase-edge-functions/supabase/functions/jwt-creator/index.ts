// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.
// Setup type definitions for built-in Supabase Runtime APIs
// import "@supabase/functions-js/edge-runtime.d.ts";
import { SignJWT } from "npm:jose@5";
import {
  isJwtTokenDatabaseConfigured,
  jwtTokenDatabaseUrlEnvVar,
  jwtTokenTableName,
  saveJwtTokenRecord,
} from "../_shared/jwt-token-store.ts";
import {
  authorizeWeatherGatewayRequest,
  weatherGatewayCallerHeader,
  weatherGatewaySecretHeader,
} from "../_shared/weather-gateway-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": `authorization, x-client-info, apikey, content-type, ${weatherGatewayCallerHeader}, ${weatherGatewaySecretHeader}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const jwtIssuer = "weather-gateway";
const jwtLifetimeSeconds = 2 * 60 * 60;
const encoder = new TextEncoder();

type JwtCreatorRequestBody = {
  userId?: string;
  role?: string;
};

type TokenRecordPayload = {
  tokenId: string;
  tokenSha: string;
  userId: string;
  role: string;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
};

type TokenPersistenceResult = {
  configured: boolean;
  saved: boolean;
  envVar: string;
  tableName: string;
};

const requiredDatabaseFields = [
  {
    name: "token_id",
    type: "uuid",
    description: "Stores the JWT jti so each token can be uniquely tracked"
  },
  {
    name: "token_sha",
    type: "varchar(64)",
    description: "Stores the SHA-256 fingerprint also included in the JWT payload as sha"
  },
  {
    name: "user_id",
    type: "varchar(255)",
    description: "Associates the token with the authenticated user"
  },
  {
    name: "role",
    type: "varchar(100)",
    description: "Persists the authorization role embedded in the token"
  },
  {
    name: "issuer",
    type: "varchar(100)",
    description: "Stores the token issuer, currently weather-gateway"
  },
  {
    name: "issued_at",
    type: "bigint",
    description: "Unix timestamp for when the token was created"
  },
  {
    name: "expires_at",
    type: "bigint",
    description: "Unix timestamp for when the token expires"
  },
  {
    name: "revoked_at",
    type: "bigint null",
    description: "Optional revocation timestamp if the token is invalidated before expiry"
  }
] as const;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function normalizeRequestBody(body: JwtCreatorRequestBody) {
  return {
    userId: typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : "anonymous",
    role: typeof body.role === "string" && body.role.trim() ? body.role.trim() : "user"
  };
}

async function createTokenSha(input: {
  userId: string;
  role: string;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
}) {
  const hashSource = JSON.stringify({
    iss: jwtIssuer,
    sub: input.userId,
    role: input.role,
    jti: input.tokenId,
    iat: input.issuedAt,
    exp: input.expiresAt
  });
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(hashSource));
  return Array.from(new Uint8Array(hashBuffer)).map((value: number)=>value.toString(16).padStart(2, "0")).join("");
}

async function buildTokenRecord(body: JwtCreatorRequestBody): Promise<TokenRecordPayload> {
  const normalizedBody = normalizeRequestBody(body);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + jwtLifetimeSeconds;
  const tokenId = crypto.randomUUID();
  const tokenSha = await createTokenSha({
    userId: normalizedBody.userId,
    role: normalizedBody.role,
    tokenId,
    issuedAt,
    expiresAt
  });
  return {
    tokenId,
    tokenSha,
    userId: normalizedBody.userId,
    role: normalizedBody.role,
    issuer: jwtIssuer,
    issuedAt,
    expiresAt,
    revokedAt: null
  };
}

async function persistTokenRecordIfConfigured(
  tokenRecord: TokenRecordPayload,
): Promise<TokenPersistenceResult> {
  const configured = isJwtTokenDatabaseConfigured();
  if (!configured) {
    return {
      configured: false,
      saved: false,
      envVar: jwtTokenDatabaseUrlEnvVar,
      tableName: jwtTokenTableName
    };
  }

  await saveJwtTokenRecord(tokenRecord);
  return {
    configured: true,
    saved: true,
    envVar: jwtTokenDatabaseUrlEnvVar,
    tableName: jwtTokenTableName
  };
}

function isJwtCreatorRequestBody(value: unknown): value is JwtCreatorRequestBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === "undefined" || typeof candidate.userId === "string"
  ) && (
    typeof candidate.role === "undefined" || typeof candidate.role === "string"
  );
}

console.log("JWT Creator function loaded.");
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
    const gatewayAuthorizationError = authorizeWeatherGatewayRequest(
      req,
      jsonResponse,
      "jwt-creator",
    );
    if (gatewayAuthorizationError) {
      return gatewayAuthorizationError;
    }
    try {
      const secretKey = Deno.env.get("MY_JWT_SECRET");
      if (!secretKey) {
        throw new Error("Missing MY_JWT_SECRET environment variable.");
      }
      const secret = encoder.encode(secretKey);
      const requestBody = await req.json();
      if (!isJwtCreatorRequestBody(requestBody)) {
        throw new Error("Request body must be a JSON object with optional string userId and role fields.");
      }

      const tokenRecord = await buildTokenRecord(requestBody);
      const jwt = await new SignJWT({
        userId: tokenRecord.userId,
        role: tokenRecord.role,
        sha: tokenRecord.tokenSha
      }).setProtectedHeader({
        alg: "HS256"
      }).setSubject(tokenRecord.userId).setJti(tokenRecord.tokenId).setIssuedAt(tokenRecord.issuedAt).setIssuer(tokenRecord.issuer).setExpirationTime(tokenRecord.expiresAt).sign(secret);
      const tokenPersistence = await persistTokenRecordIfConfigured(tokenRecord);
      return jsonResponse(200, {
        token: jwt,
        tokenRecord,
        tokenPersistence,
        requiredDatabaseFields
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse(400, {
        error: message
      });
    }
  }
}; /* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Call this function through weather-gateway with WEATHER_GATEWAY_INTERNAL_SECRET configured.

*/ 
