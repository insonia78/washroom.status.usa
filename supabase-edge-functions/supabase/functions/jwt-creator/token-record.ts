import { isJwtTokenDatabaseConfigured, jwtTokenDatabaseUrlEnvVar, jwtTokenTableName, saveJwtTokenRecord } from "../_shared/jwt-token-store.ts";

export const jwtIssuer = "washroom-gateway";
export const jwtLifetimeSeconds = 2 * 60 * 60;
export const encoder = new TextEncoder();

export type JwtCreatorRequestBody = {
  userId?: string;
  role?: string;
};

export type TokenRecordPayload = {
  tokenId: string;
  tokenSha: string;
  userId: string;
  role: string;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
};

export type TokenPersistenceResult = {
  configured: boolean;
  saved: boolean;
  envVar: string;
  tableName: string;
};

// Applies safe defaults and trims user and role values from the request.
export function normalizeRequestBody(body: JwtCreatorRequestBody) {
  return {
    userId: typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : "anonymous",
    role: typeof body.role === "string" && body.role.trim() ? body.role.trim() : "user"
  };
}

// Creates the SHA-256 fingerprint stored with a newly generated token.
export async function createTokenSha(input: {
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

// Builds the token claims and persistence record with a unique ID and lifetime.
export async function buildTokenRecord(body: JwtCreatorRequestBody): Promise<TokenRecordPayload> {
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

// Persists a token when the database is configured and reports persistence status.
export async function persistTokenRecordIfConfigured(
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

// Checks that the request body contains only supported string fields.
export function isJwtCreatorRequestBody(value: unknown): value is JwtCreatorRequestBody {
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
