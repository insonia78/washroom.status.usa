import {
  turnstileProtectionEnabled,
  turnstileSecretKey,
  turnstileVerifyUrl,
} from "./config.ts";
import { jsonResponse } from "./http.ts";
import { getErrorMessage, logGatewayEvent } from "./logging.ts";

// Extracts the best available client IP address from proxy headers.
export function getRequestIpAddress(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",");
    if (firstIp?.trim()) {
      return firstIp.trim();
    }
  }

  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  if (cfConnectingIp?.trim()) {
    return cfConnectingIp.trim();
  }

  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp?.trim()) {
    return xRealIp.trim();
  }

  return "";
}

// Verifies a Turnstile challenge when login protection is enabled.
export async function verifyTurnstileChallenge(
  req: Request,
  turnstileToken: string,
) {
  if (!turnstileProtectionEnabled) {
    return null;
  }

  if (!turnstileSecretKey?.trim()) {
    return jsonResponse(503, {
      error: "Cloudflare Turnstile protection is not configured for login.",
    }, req);
  }

  if (!turnstileToken) {
    return jsonResponse(400, {
      error: "Complete the security check before signing in.",
    }, req);
  }

  const verificationBody = new URLSearchParams({
    secret: turnstileSecretKey.trim(),
    response: turnstileToken,
  });
  const remoteIp = getRequestIpAddress(req);
  if (remoteIp) {
    verificationBody.set("remoteip", remoteIp);
  }

  let verificationResponse: Response;
  try {
    verificationResponse = await fetch(turnstileVerifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: verificationBody,
    });
  } catch (error) {
    logGatewayEvent("error", "turnstile.verification.failed", {
      details: getErrorMessage(error),
    });
    return jsonResponse(502, {
      error: "Unable to verify the security check right now.",
    }, req);
  }

  const verificationPayload = await verificationResponse.json().catch(() =>
    null
  ) as {
    success?: boolean;
    ["error-codes"]?: string[];
  } | null;

  if (!verificationResponse.ok) {
    return jsonResponse(502, {
      error: "Unable to verify the security check right now.",
    }, req);
  }

  if (!verificationPayload?.success) {
    const errorCodes = verificationPayload?.["error-codes"] ?? [];
    const challengeExpired = errorCodes.includes("timeout-or-duplicate");
    return jsonResponse(403, {
      error: challengeExpired
        ? "The security check expired. Please try again."
        : "Security check verification failed. Please try again.",
    }, req);
  }

  return null;
}
