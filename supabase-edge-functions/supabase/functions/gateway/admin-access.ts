import { fetchAccountApiResponse } from "./account-api.ts";
import {
  ensureAdminAccount,
  getAdminAccountResponseDetails,
  isAdminEmailRequestBody,
  parseJsonBodyFromBlob,
} from "./account-payload.ts";
import { jsonResponse } from "./http.ts";

// Validates the email and returns the administrator's access and setup state.
export async function buildAdminAccessResponse(
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

  if (!isAdminEmailRequestBody(parsedBody)) {
    return jsonResponse(400, {
      error: "Request body must include an email field",
    }, req);
  }

  const email = parsedBody.email.trim();
  if (!email) {
    return jsonResponse(400, {
      error: "Email is required",
    }, req);
  }

  const { response, body } = await fetchAccountApiResponse("/accounts/access", {
    email,
  }, {
    attempts: 3,
    retryableStatusCodes: [500, 502, 503, 504],
  });
  if (!response.ok) {
    return jsonResponse(
      response.status,
      body ?? { error: "Failed to read account access state" },
      req,
    );
  }

  const details = getAdminAccountResponseDetails(body);
  if (!details) {
    return jsonResponse(502, {
      error: "Account access response payload is invalid",
    }, req);
  }

  const adminError = ensureAdminAccount(details, req);
  if (adminError) {
    return adminError;
  }

  return jsonResponse(200, {
    email: details.email,
    role: details.role,
    passwordSetupRequired: details.passwordSetupRequired,
  }, req);
}
