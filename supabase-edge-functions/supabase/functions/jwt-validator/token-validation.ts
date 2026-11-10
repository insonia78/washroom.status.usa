import { jwtVerify } from "npm:jose@5";
import { isJwtTokenDatabaseConfigured, jwtTokenDatabaseUrlEnvVar, findJwtTokenRecordById } from "../_shared/jwt-token-store.ts";

export const supabaseJwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
export const customJwtSecret = Deno.env.get("MY_JWT_SECRET") ?? Deno.env.get("CUSTOM_JWT_SECRET");
export const encoder = new TextEncoder();

// Reads a string claim from a decoded JWT payload.
export function getPayloadStringValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

// Reads a finite numeric claim from a decoded JWT payload.
export function getPayloadNumberValue(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type VerifiedToken = {
  payload: Record<string, unknown>;
  tokenType: "supabase" | "custom";
};

export type CustomTokenDatabaseValidationResult =
  | { valid: true }
  | { valid: false; status: number; error: string };

// Tries the configured Supabase and custom signing secrets in order.
export async function verifyToken(token: string): Promise<VerifiedToken | null> {
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

// Confirms a custom JWT matches an active, unexpired persisted token record.
export async function validateCustomTokenAgainstDatabase(
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
