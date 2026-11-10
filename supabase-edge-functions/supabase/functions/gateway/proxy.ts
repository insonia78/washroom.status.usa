import {
  buildGatewayHeaders,
  gatewayAuthorizationHeader,
} from "../_shared/gateway-auth.ts";
import { buildForwardHeaders as buildUserForwardHeaders } from "./build-forward-headers.ts";
import { gatewayInternalSecret } from "./config.ts";
import { clientIpHeader } from "../_shared/gateway-client-ip.ts";
import {
  getErrorMessage,
  logGatewayEvent,
  summarizeForwardHeaders,
  summarizeRequestBody,
} from "./logging.ts";
import { SERVICES } from "./models.ts";
import {
  buildContainerReachableBackendUrl,
  buildTargetUrl,
  extractProxyPath,
} from "./routing.ts";
import type { VerifiedToken } from "./utils.ts";

// Reads the incoming body when the HTTP method permits one.
export async function buildForwardBody(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") {
    return null;
  }

  return await req.blob();
}

// Builds downstream headers, including verified user metadata and gateway credentials.
export function buildProxyHeaders(
  req: Request,
  service: SERVICES | null,
  verifiedToken: VerifiedToken | null,
) {
  const headers = service === SERVICES.PLACES && verifiedToken
    ? buildUserForwardHeaders(
      req,
      verifiedToken.payload,
      verifiedToken.tokenType,
    )
    : new Headers(req.headers);

  headers.delete("host");
  headers.delete("content-length");
  headers.delete(clientIpHeader);
  headers.delete("x-washroom-device-token");
  const cookies = headers.get("cookie");
  if (cookies !== null) {
    const remainingCookies = cookies.split(";")
      .filter((cookie) => cookie.trim().split("=", 1)[0] !== "washroom_device")
      .join(";").trim();
    if (remainingCookies) headers.set("cookie", remainingCookies);
    else headers.delete("cookie");
  }

  if (service === SERVICES.AUTH) {
    const clientAuthorization = headers.get("authorization") ??
      headers.get("Authorization");
    if (clientAuthorization) {
      headers.set(gatewayAuthorizationHeader, clientAuthorization);
      headers.delete("authorization");
      headers.delete("Authorization");
    }
  }

  if (
    (
      service === SERVICES.ACCOUNTS ||
      service === SERVICES.AUTH ||
      service === SERVICES.ADMIN ||
      service === SERVICES.FRONTEND ||
      service === SERVICES.PLACES
    ) &&
    gatewayInternalSecret
  ) {
    const gatewayHeaders = buildGatewayHeaders(gatewayInternalSecret);
    Object.entries(gatewayHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  return headers;
}

// Forwards a request to its backend and retries local endpoints through the container host if needed.
export async function fetchBackendResponse(
  req: Request,
  service: SERVICES | null,
  verifiedToken: VerifiedToken | null,
  targetUrl: URL,
  requestBody: Blob | null,
  backendBaseUrl: string,
  requestId: string,
  options?: {
    methodOverride?: string;
    proxyPathOverride?: string;
  },
) {
  const headers = buildProxyHeaders(req, service, verifiedToken);
  const method = options?.methodOverride ?? req.method;
  const proxyPath = options?.proxyPathOverride ??
    extractProxyPath(new URL(req.url).pathname);

  logGatewayEvent("info", "proxy.forwarding.started", {
    requestId,
    method,
    proxyPath,
    targetUrl: targetUrl.toString(),
    ...summarizeForwardHeaders(headers),
    ...summarizeRequestBody(requestBody),
  });

  try {
    return await fetch(targetUrl, {
      method,
      headers,
      body: requestBody,
    });
  } catch (error) {
    const initialErrorMessage = getErrorMessage(error);
    const containerReachableBackendUrl = buildContainerReachableBackendUrl(
      backendBaseUrl,
    );
    if (!containerReachableBackendUrl) {
      logGatewayEvent("error", "proxy.forwarding.failed", {
        requestId,
        targetUrl: targetUrl.toString(),
        usedContainerFallback: false,
        details: initialErrorMessage,
      });
      throw error;
    }

    const containerTargetUrl = buildTargetUrl(
      containerReachableBackendUrl,
      proxyPath,
      targetUrl.search,
      service,
    );

    logGatewayEvent("warn", "proxy.forwarding.retrying-with-container-host", {
      requestId,
      targetUrl: targetUrl.toString(),
      fallbackTargetUrl: containerTargetUrl.toString(),
      details: initialErrorMessage,
    });

    return await fetch(containerTargetUrl, {
      method,
      headers,
      body: requestBody,
    });
  }
}
