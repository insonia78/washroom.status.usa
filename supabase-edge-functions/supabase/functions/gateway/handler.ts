import { buildAccountDeactivateResponse } from "./account-deactivate.ts";
import { buildAccountLoginResponse } from "./account-login.ts";
import { buildAdminAccessResponse } from "./admin-access.ts";
import { buildAdminLoginResponse } from "./admin-login.ts";
import { buildAdminCreatePasswordResponse } from "./admin-password.ts";
import { buildCorsHeaders, jsonResponse } from "./http.ts";
import {
  buildRequestLogContext,
  getErrorMessage,
  getHeaderPresence,
  logGatewayEvent,
} from "./logging.ts";
import { SERVICES } from "./models.ts";
import { fetchBackendResponse } from "./proxy.ts";
import { respondToBackend } from "./proxy-response.ts";
import { resolveProxyRequest } from "./resolve-request.ts";
import {
  isAccountDeactivatePath,
  isAccountLoginPath,
  isAdminAccessPath,
  isAdminCreatePasswordPath,
  isAdminLoginPath,
  isPublicPlacesPath,
} from "./routing.ts";
import type { VerifiedToken } from "./utils.ts";
import { verifyTokenWithValidator } from "./verify-token-validator.ts";

// Authorizes routes, performs specialized auth flows, then proxies requests and responses.
export async function handleGatewayRequest(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  logGatewayEvent(
    "info",
    "request.received",
    buildRequestLogContext(req, requestId),
  );

  if (req.method === "OPTIONS") {
    logGatewayEvent("info", "request.preflight", {
      requestId,
      pathname: new URL(req.url).pathname,
    });
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  const resolved = await resolveProxyRequest(req, requestId);
  if (resolved instanceof Response) return resolved;
  const { proxyPath, service, backendBaseUrl, requestBody, targetUrl } =
    resolved;

  try {
    let verifiedToken: VerifiedToken | null = null;
    if (service === SERVICES.AUTH) {
      logGatewayEvent("info", "auth.logout.requested", {
        requestId,
        proxyPath,
        targetUrl: targetUrl.toString(),
        ...getHeaderPresence(req),
      });
    }

    if (service === SERVICES.ADMIN && isAdminAccessPath(proxyPath)) {
      return await buildAdminAccessResponse(req, requestBody);
    }

    if (service === SERVICES.ACCOUNTS && isAccountLoginPath(proxyPath)) {
      return await buildAccountLoginResponse(req, requestBody);
    }

    if (service === SERVICES.ADMIN && isAdminLoginPath(proxyPath)) {
      return await buildAdminLoginResponse(req, requestBody);
    }

    if (service === SERVICES.ADMIN && isAdminCreatePasswordPath(proxyPath)) {
      return await buildAdminCreatePasswordResponse(req, requestBody);
    }

    if (
      (service === SERVICES.ACCOUNTS && isAccountDeactivatePath(proxyPath)) ||
      (service === SERVICES.PLACES && !isPublicPlacesPath(proxyPath))
    ) {
      logGatewayEvent("info", "token.validation.started", {
        requestId,
        proxyPath,
        ...getHeaderPresence(req),
      });

      const validationResult = await verifyTokenWithValidator(
        req,
        jsonResponse,
      );
      const { errorResponse } = validationResult;
      if (errorResponse) {
        logGatewayEvent("warn", "token.validation.failed", {
          requestId,
          proxyPath,
        });
        return errorResponse;
      }

      verifiedToken = validationResult.verifiedToken;
      logGatewayEvent("info", "token.validation.succeeded", {
        requestId,
        proxyPath,
        tokenType: verifiedToken?.tokenType ?? null,
        hasSubject: Boolean(
          verifiedToken?.payload &&
            typeof verifiedToken.payload.sub === "string" &&
            verifiedToken.payload.sub.length > 0,
        ),
      });
    }

    if (service === SERVICES.ACCOUNTS && isAccountDeactivatePath(proxyPath)) {
      return await buildAccountDeactivateResponse(req, verifiedToken);
    }

    const backendResponse = await fetchBackendResponse(
      req,
      service,
      verifiedToken,
      targetUrl,
      requestBody,
      backendBaseUrl,
      requestId,
    );

    if (service === SERVICES.AUTH) {
      logGatewayEvent("info", "auth.logout.forwarded", {
        requestId,
        proxyPath,
        targetUrl: targetUrl.toString(),
        status: backendResponse.status,
        ok: backendResponse.ok,
      });
    }

    return await respondToBackend(req, backendResponse, {
      service,
      requestId,
      proxyPath,
      startedAt,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    logGatewayEvent("error", "proxy.failed", {
      requestId,
      proxyPath,
      service,
      durationMs: Date.now() - startedAt,
      details: message,
    });
    return jsonResponse(502, {
      error: "Gateway failed to reach destination server",
      details: message,
    }, req);
  }
}
