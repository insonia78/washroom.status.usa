import { withJwtTokenDatabase } from "./jwt-token-database.ts";

export { getJwtTokenDatabaseUrl, isJwtTokenDatabaseConfigured, jwtTokenDatabaseUrlEnvVar, jwtTokenTableName, withJwtTokenDatabase } from "./jwt-token-database.ts";

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

// Inserts a newly issued JWT record for later validation and revocation.
export async function saveJwtTokenRecord(record: PersistedJwtTokenRecord): Promise<void> {
  await withJwtTokenDatabase(async (sql) => {
    await sql`
      insert into app_accounts.jwt_tokens (
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

// Converts a numeric database field and rejects malformed values.
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

// Maps a database row into the typed JWT record used by the edge functions.
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

// Looks up a persisted token by its unique JWT ID.
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
      from app_accounts.jwt_tokens
      where token_id = ${tokenId}
      limit 1
    `;

    return rows[0] ? normalizeJwtTokenRecord(rows[0]) : null;
  });
}

// Marks one active token as revoked and returns its updated record.
export async function revokeJwtTokenRecord(
  tokenId: string,
  revokedAt = Math.floor(Date.now() / 1000),
): Promise<PersistedJwtTokenRecord | null> {
  return await withJwtTokenDatabase(async (sql) => {
    const rows = await sql<PersistedJwtTokenRecordRow[]>`
      update app_accounts.jwt_tokens
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

// Revokes every currently active JWT associated with a user.
export async function revokeJwtTokenRecordsForUser(
  userId: string,
  revokedAt = Math.floor(Date.now() / 1000),
): Promise<number> {
  return await withJwtTokenDatabase(async (sql) => {
    const rows = await sql<Array<{ tokenId: string }>>`
      update app_accounts.jwt_tokens
      set revoked_at = ${revokedAt}
      where user_id = ${userId}
        and revoked_at is null
      returning token_id as "tokenId"
    `;

    return rows.length;
  });
}
