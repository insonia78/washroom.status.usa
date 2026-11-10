import { adminRole } from "./config.ts";
import { jsonResponse } from "./http.ts";

// Returns a trimmed string field from an object, or an empty string.
export function getRecordStringValue(
  record: Record<string, unknown>,
  key: string,
) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

// Validates the email-only body used for administrator access checks.
export function isAdminEmailRequestBody(
  value: unknown,
): value is { email: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.email === "string";
}

// Validates the email and password body used by account login routes.
export function isAdminLoginRequestBody(
  value: unknown,
): value is { email: string; password: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.email === "string" &&
    typeof record.password === "string";
}

// Reads the optional Turnstile token from a request body.
export function getTurnstileToken(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  return typeof record.turnstileToken === "string"
    ? record.turnstileToken.trim()
    : "";
}

// Reuses login-body validation for administrator password setup.
export function isAdminCreatePasswordRequestBody(
  value: unknown,
): value is { email: string; password: string } {
  return isAdminLoginRequestBody(value);
}

// Parses a non-empty JSON body from the buffered request body.
export async function parseJsonBodyFromBlob(requestBody: Blob | null) {
  if (!requestBody) {
    return null;
  }

  const text = await requestBody.text();
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text);
}

// Extracts the email, role, and password-setup status from an account response.
export function getAdminAccountResponseDetails(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const email = getRecordStringValue(record, "email");
  const role = getRecordStringValue(record, "role");
  if (!email || !role) {
    return null;
  }

  return {
    email,
    role,
    passwordSetupRequired: Boolean(record.password_setup_required),
  };
}

// Rejects account details that do not represent an administrator.
export function ensureAdminAccount(
  details: { email: string; role: string },
  req: Request,
) {
  if (details.role !== adminRole) {
    return jsonResponse(403, {
      error: "Only administrator accounts can access the administration app",
    }, req);
  }

  return null;
}
