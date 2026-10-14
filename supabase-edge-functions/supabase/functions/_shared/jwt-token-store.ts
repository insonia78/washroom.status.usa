import postgres from "npm:postgres";

export const jwtTokenDatabaseUrlEnvVar = "JWT_TOKEN_DATABASE_URL";
export const jwtTokenTableName = "jwt_tokens";
const jwtTokenDatabasePoolMaxEnvVar = "JWT_TOKEN_DATABASE_POOL_MAX";
const jwtTokenDatabaseIdleTimeoutSecondsEnvVar = "JWT_TOKEN_DATABASE_IDLE_TIMEOUT_SECONDS";
const jwtTokenDatabaseConnectTimeoutSecondsEnvVar = "JWT_TOKEN_DATABASE_CONNECT_TIMEOUT_SECONDS";
const defaultJwtTokenDatabasePoolMax = 2;
const defaultJwtTokenDatabaseIdleTimeoutSeconds = 30;
const defaultJwtTokenDatabaseConnectTimeoutSeconds = 5;

export type PersistedJwtTokenRecord = {
  tokenId: string;
  tokenSha: string;
  userId: string;
  role: string;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
};

type PersistedJwtTokenRecordRow = {
  tokenId: string;
  tokenSha: string;
  userId: string;
  role: string;
  issuer: string;
  issuedAt: number | string;
  expiresAt: number | string;
  revokedAt: number | string | null;
};

type SqlClient = ReturnType<typeof postgres>;
let sharedSqlClient: SqlClient | null = null;

export function getJwtTokenDatabaseUrl(): string | null {
  const databaseUrl = Deno.env.get(jwtTokenDatabaseUrlEnvVar)?.trim();
  return databaseUrl ? databaseUrl : null;
}

export function isJwtTokenDatabaseConfigured(): boolean {
  return Boolean(getJwtTokenDatabaseUrl());
}

function readPositiveIntegerEnv(envVarName: string, fallback: number): number {
  const rawValue = Deno.env.get(envVarName)?.trim() ?? "";
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function getJwtTokenDatabaseClient(): SqlClient {
  if (sharedSqlClient) {
    return sharedSqlClient;
  }

  const databaseUrl = getJwtTokenDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(`Missing ${jwtTokenDatabaseUrlEnvVar} environment variable.`);
  }

  sharedSqlClient = postgres(databaseUrl, {
    max: readPositiveIntegerEnv(jwtTokenDatabasePoolMaxEnvVar, defaultJwtTokenDatabasePoolMax),
    prepare: false,
    connect_timeout: readPositiveIntegerEnv(
      jwtTokenDatabaseConnectTimeoutSecondsEnvVar,
      defaultJwtTokenDatabaseConnectTimeoutSeconds,
    ),
    idle_timeout: readPositiveIntegerEnv(
      jwtTokenDatabaseIdleTimeoutSecondsEnvVar,
      defaultJwtTokenDatabaseIdleTimeoutSeconds,
    ),
  });

  return sharedSqlClient;
}

export async function withJwtTokenDatabase<T>(
  callback: (sql: SqlClient) => Promise<T>,
): Promise<T> {
  return await callback(getJwtTokenDatabaseClient());
}

export async function saveJwtTokenRecord(record: PersistedJwtTokenRecord): Promise<void> {
  await withJwtTokenDatabase(async (sql) => {
    await sql`
      insert into jwt_tokens (
        token_id,
        token_sha,
        user_id,
        role,
        issuer,
        issued_at,
        expires_at,
        revoked_at
      ) values (
        ${record.tokenId},
        ${record.tokenSha},
        ${record.userId},
        ${record.role},
        ${record.issuer},
        ${record.issuedAt},
        ${record.expiresAt},
        ${record.revokedAt}
      )
    `;
  });
}

function parseDatabaseNumber(value: number | string, fieldName: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Invalid numeric value returned for ${fieldName}`);
}

function normalizeJwtTokenRecord(row: PersistedJwtTokenRecordRow): PersistedJwtTokenRecord {
  return {
    tokenId: row.tokenId,
    tokenSha: row.tokenSha,
    userId: row.userId,
    role: row.role,
    issuer: row.issuer,
    issuedAt: parseDatabaseNumber(row.issuedAt, "issuedAt"),
    expiresAt: parseDatabaseNumber(row.expiresAt, "expiresAt"),
    revokedAt: row.revokedAt === null ? null : parseDatabaseNumber(row.revokedAt, "revokedAt"),
  };
}

export async function findJwtTokenRecordById(tokenId: string): Promise<PersistedJwtTokenRecord | null> {
  return await withJwtTokenDatabase(async (sql) => {
    const rows = await sql<PersistedJwtTokenRecordRow[]>`
      select
        token_id as "tokenId",
        token_sha as "tokenSha",
        user_id as "userId",
        role,
        issuer,
        issued_at as "issuedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt"
      from jwt_tokens
      where token_id = ${tokenId}
      limit 1
    `;

    return rows[0] ? normalizeJwtTokenRecord(rows[0]) : null;
  });
}

export async function revokeJwtTokenRecord(
  tokenId: string,
  revokedAt = Math.floor(Date.now() / 1000),
): Promise<PersistedJwtTokenRecord | null> {
  return await withJwtTokenDatabase(async (sql) => {
    const rows = await sql<PersistedJwtTokenRecordRow[]>`
      update jwt_tokens
      set revoked_at = ${revokedAt}
      where token_id = ${tokenId}
        and revoked_at is null
      returning
        token_id as "tokenId",
        token_sha as "tokenSha",
        user_id as "userId",
        role,
        issuer,
        issued_at as "issuedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt"
    `;

    return rows[0] ? normalizeJwtTokenRecord(rows[0]) : null;
  });
}

export async function revokeJwtTokenRecordsForUser(
  userId: string,
  revokedAt = Math.floor(Date.now() / 1000),
): Promise<number> {
  return await withJwtTokenDatabase(async (sql) => {
    const rows = await sql<Array<{ tokenId: string }>>`
      update jwt_tokens
      set revoked_at = ${revokedAt}
      where user_id = ${userId}
        and revoked_at is null
      returning token_id as "tokenId"
    `;

    return rows.length;
  });
}
