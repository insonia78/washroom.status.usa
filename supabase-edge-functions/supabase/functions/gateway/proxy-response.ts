import {
  buildProxiedResponse,
  buildResponseHeaders,
  canResponseHaveBody,
  parseBackendBody,
  shouldProxyRawResponseBody,
  summarizeProxiedBody,
} from "./http.ts";
import { logGatewayEvent } from "./logging.ts";
import { SERVICES } from "./models.ts";

export async function respondToBackend(
  req: Request,
  backendResponse: Response,
  context: {
    service: SERVICES | null;
    requestId: string;
    proxyPath: string;
    startedAt: number;
  },
) {
  const { service, requestId, proxyPath, startedAt } = context;
  const responseHeaders = buildResponseHeaders(backendResponse.headers, req);
  const responseContentType = backendResponse.headers.get("content-type") ?? "";
  const proxyRawResponseBody =
    canResponseHaveBody(req.method, backendResponse.status) &&
    shouldProxyRawResponseBody(responseContentType);
  const responseBody = canResponseHaveBody(req.method, backendResponse.status)
    ? proxyRawResponseBody
      ? backendResponse.body
      : await parseBackendBody(backendResponse)
    : null;

  if (service === SERVICES.AUTH) {
    logGatewayEvent(
      backendResponse.ok ? "info" : "warn",
      "auth.logout.response",
      {
        requestId,
        proxyPath,
        status: backendResponse.status,
        ok: backendResponse.ok,
        ...summarizeProxiedBody(
          responseContentType,
          proxyRawResponseBody,
          responseBody,
        ),
        responseBody,
      },
    );
  }

  logGatewayEvent("info", "proxy.completed", {
    requestId,
    proxyPath,
    service,
    status: backendResponse.status,
    ok: backendResponse.ok,
    contentType: responseContentType,
    responseContentLength: backendResponse.headers.get("content-length"),
    ...summarizeProxiedBody(
      responseContentType,
      proxyRawResponseBody,
      responseBody,
    ),
    durationMs: Date.now() - startedAt,
  });

  return buildProxiedResponse(
    req,
    backendResponse.status,
    responseHeaders,
    responseBody,
  );
}
