import {
  isJwtTokenDatabaseConfigured,
  revokeJwtTokenRecordsForUser,
} from "../_shared/jwt-token-store.ts";
import { fetchAccountApiResponse } from "./account-api.ts";
import { jsonResponse } from "./http.ts";
import type { VerifiedToken } from "./utils.ts";

// Revokes the user's active JWTs before asking the account service to deactivate them.
export async function buildAccountDeactivateResponse(
  req: Request,
  verifiedToken: VerifiedToken | null,
) {
  if (!verifiedToken) {
    return jsonResponse(401, {
      error: "Missing verified account identity for account deactivation",
    }, req);
  }

  const accountEmail =
    verifiedToken?.payload && typeof verifiedToken.payload.sub === "string"
      ? verifiedToken.payload.sub.trim()
      : "";

  if (!accountEmail) {
    return jsonResponse(401, {
      error: "Authenticated account email is required for account deactivation",
    }, req);
  }

  if (!isJwtTokenDatabaseConfigured()) {
    return jsonResponse(500, {
      error:
        "JWT token persistence must be configured before deleting an account.",
    }, req);
  }

  await revokeJwtTokenRecordsForUser(accountEmail);

  const { response, body } = await fetchAccountApiResponse(
    "/accounts/deactivate",
    {
      email: accountEmail,
    },
  );
  if (!response.ok) {
    return jsonResponse(
      response.status,
      body ?? { error: "Failed to delete account" },
      req,
    );
  }

  return jsonResponse(200, {
    deleted: true,
    email: accountEmail,
  }, req);
}
