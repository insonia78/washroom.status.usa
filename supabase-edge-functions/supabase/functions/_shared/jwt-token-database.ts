import postgres from "npm:postgres";

export const jwtTokenDatabaseUrlEnvVar = "JWT_TOKEN_DATABASE_URL";
export const jwtTokenTableName = "app_accounts.jwt_tokens";
const jwtTokenDatabasePoolMaxEnvVar = "JWT_TOKEN_DATABASE_POOL_MAX";
const jwtTokenDatabaseIdleTimeoutSecondsEnvVar = "JWT_TOKEN_DATABASE_IDLE_TIMEOUT_SECONDS";
const jwtTokenDatabaseConnectTimeoutSecondsEnvVar = "JWT_TOKEN_DATABASE_CONNECT_TIMEOUT_SECONDS";
const defaultJwtTokenDatabasePoolMax = 2;
const defaultJwtTokenDatabaseIdleTimeoutSeconds = 30;
const defaultJwtTokenDatabaseConnectTimeoutSeconds = 5;

type SqlClient = ReturnType<typeof postgres>;
let sharedSqlClient: SqlClient | null = null;

// Reads the optional database connection URL used for persisted custom JWTs.
export function getJwtTokenDatabaseUrl(): string | null {
  const databaseUrl = Deno.env.get(jwtTokenDatabaseUrlEnvVar)?.trim();
  return databaseUrl ? databaseUrl : null;
}

// Reports whether persistent JWT storage has been configured.
export function isJwtTokenDatabaseConfigured(): boolean {
  return Boolean(getJwtTokenDatabaseUrl());
}

// Reads a positive integer setting or uses its supplied default.
function readPositiveIntegerEnv(envVarName: string, fallback: number): number {
  const rawValue = Deno.env.get(envVarName)?.trim() ?? "";
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

// Lazily creates and reuses the PostgreSQL client for JWT persistence.
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

// Runs a database operation using the shared PostgreSQL client.
export async function withJwtTokenDatabase<T>(
  callback: (sql: SqlClient) => Promise<T>,
): Promise<T> {
  return await callback(getJwtTokenDatabaseClient());
}
