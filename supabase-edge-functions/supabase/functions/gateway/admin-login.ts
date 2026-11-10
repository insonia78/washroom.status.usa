import { fetchAccountApiResponse } from "./account-api.ts";
import {
  ensureAdminAccount,
  getAdminAccountResponseDetails,
  getRecordStringValue,
  getTurnstileToken,
  isAdminLoginRequestBody,
  parseJsonBodyFromBlob,
} from "./account-payload.ts";
import { createJwtForIdentity } from "./account-token.ts";
import { jsonResponse } from "./http.ts";
import { verifyTurnstileChallenge } from "./turnstile.ts";

// Authenticates an administrator and issues a JWT only after role and setup checks.
export async function buildAdminLoginResponse(
  req: Request,
  requestBody: Blob | null,
) {
  let parsedBody: unknown;
  try {
    parsedBody = await parseJsonBodyFromBlob(requestBody);
  } catch {
    return jsonResponse(400, {
      error: "Request body must be valid JSON",
    }, req);
  }

  if (!isAdminLoginRequestBody(parsedBody)) {
    return jsonResponse(400, {
      error: "Request body must include string email and password fields",
    }, req);
  }

  const email = parsedBody.email.trim();
  const password = parsedBody.password;
  if (!email || !password) {
    return jsonResponse(400, {
      error: "Email and password are required",
    }, req);
  }

  const turnstileError = await verifyTurnstileChallenge(
    req,
    getTurnstileToken(parsedBody),
  );
  if (turnstileError) {
    return turnstileError;
  }

  const { response, body } = await fetchAccountApiResponse("/accounts/login", {
    email,
    password,
  });
  if (!response.ok) {
    return jsonResponse(
      response.status,
      body ?? { error: "Failed to authenticate account" },
      req,
    );
  }

  const details = getAdminAccountResponseDetails(body);
  if (!details) {
    return jsonResponse(502, {
      error: "Account login response payload is invalid",
    }, req);
  }

  const adminError = ensureAdminAccount(details, req);
  if (adminError) {
    return adminError;
  }

  if (details.passwordSetupRequired) {
    return jsonResponse(401, {
      error: "Password setup is required for this account",
      passwordSetupRequired: true,
    }, req);
  }

  const jwtPayload = await createJwtForIdentity(req, {
    userId: details.email,
    role: details.role,
  });

  return jsonResponse(200, {
    token: getRecordStringValue(jwtPayload, "token"),
    tokenRecord: jwtPayload.tokenRecord ?? null,
    userId: details.email,
    role: details.role,
  }, req);
}
