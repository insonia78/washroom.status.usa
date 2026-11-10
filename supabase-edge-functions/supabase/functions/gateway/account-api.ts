import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";
import {
  defaultRetryDelayMs,
  gatewayInternalSecret,
  registrationApiUrl,
} from "./config.ts";
import { logGatewayEvent } from "./logging.ts";

// Waits for the requested duration between retry attempts.
export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves an account API endpoint against the configured registration service.
export function getAccountApiUrl(pathname: string) {
  if (!registrationApiUrl) {
    throw new Error(
      "Missing WASHROOM_REGISTRATION_API_URL environment variable.",
    );
  }

  return new URL(
    pathname,
    registrationApiUrl.endsWith("/")
      ? registrationApiUrl
      : `${registrationApiUrl}/`,
  );
}

// Calls the registration API with optional bounded retries for transient failures.
export async function fetchAccountApiResponse(
  pathname: string,
  body: Record<string, unknown>,
  options?: {
    attempts?: number;
    retryableStatusCodes?: number[];
  },
) {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (gatewayInternalSecret) {
    const gatewayHeaders = buildGatewayHeaders(gatewayInternalSecret);
    Object.entries(gatewayHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  const attempts = Math.max(1, options?.attempts ?? 1);
  const retryableStatusCodes = new Set(options?.retryableStatusCodes ?? []);
  let response: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      response = await fetch(getAccountApiUrl(pathname), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!retryableStatusCodes.has(response.status) || attempt === attempts) {
        break;
      }

      logGatewayEvent("warn", "accounts.retrying-transient-response", {
        pathname,
        attempt,
        status: response.status,
      });
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        throw error;
      }

      logGatewayEvent("warn", "accounts.retrying-transient-error", {
        pathname,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await delay(defaultRetryDelayMs * attempt);
  }

  if (!response) {
    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error(
      `Account request for ${pathname} failed without a response.`,
    );
  }

  return {
    response,
    body: await response.json().catch(() => null) as unknown,
  };
}
