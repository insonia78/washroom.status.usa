export const requiredDatabaseFields = [
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
    description: "Stores the token issuer, currently washroom-gateway"
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
