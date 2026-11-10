import { fetchAccountApiResponse } from "./account-api.ts";
import {
  getTurnstileToken,
  isAdminLoginRequestBody,
  parseJsonBodyFromBlob,
} from "./account-payload.ts";
import { appendTokenForAccountRoutes } from "./account-token.ts";
import { jsonResponse } from "./http.ts";
import { verifyTurnstileChallenge } from "./turnstile.ts";

// Authenticates a standard account and appends a custom token to the result.
export async function buildAccountLoginResponse(
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

  const payloadWithToken = await appendTokenForAccountRoutes(req, body);
  return jsonResponse(response.status, payloadWithToken, req);
}
