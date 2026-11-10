import { fetchAccountApiResponse } from "./account-api.ts";
import {
  ensureAdminAccount,
  getAdminAccountResponseDetails,
  getRecordStringValue,
  isAdminCreatePasswordRequestBody,
  parseJsonBodyFromBlob,
} from "./account-payload.ts";
import { createJwtForIdentity } from "./account-token.ts";
import { jsonResponse } from "./http.ts";

// Sets an administrator password and issues a JWT after account verification.
export async function buildAdminCreatePasswordResponse(
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

  if (!isAdminCreatePasswordRequestBody(parsedBody)) {
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

  const { response, body } = await fetchAccountApiResponse(
    "/accounts/password/setup",
    {
      email,
      password,
    },
  );
  if (!response.ok) {
    return jsonResponse(
      response.status,
      body ?? { error: "Failed to create account password" },
      req,
    );
  }

  const details = getAdminAccountResponseDetails(body);
  if (!details) {
    return jsonResponse(502, {
      error: "Password setup response payload is invalid",
    }, req);
  }

  const adminError = ensureAdminAccount(details, req);
  if (adminError) {
    return adminError;
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
