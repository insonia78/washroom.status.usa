import { FUNCTION_NAME } from "./config.ts";
import { jsonResponse } from "./http.ts";
import {
  logGatewayEvent,
  summarizeBackendUrl,
  summarizeRequestBody,
} from "./logging.ts";
import { buildForwardBody } from "./proxy.ts";
import {
  buildTargetUrl,
  extractProxyPath,
  inferService,
  matchRoute,
  resolveBackendUrl,
} from "./routing.ts";

export async function resolveProxyRequest(req: Request, requestId: string) {
  const requestUrl = new URL(req.url);
  const proxyPath = extractProxyPath(requestUrl.pathname);
  const matchedRoute = matchRoute(proxyPath);
  if (!matchedRoute) {
    logGatewayEvent("warn", "route.not-exposed", {
      requestId,
      proxyPath,
      method: req.method,
    });
    return jsonResponse(404, {
      error: `Endpoint not exposed by ${FUNCTION_NAME}`,
      path: proxyPath,
    }, req);
  }

  if (!matchedRoute.methods.includes(req.method)) {
    logGatewayEvent("warn", "route.method-not-allowed", {
      requestId,
      proxyPath,
      method: req.method,
      allowedMethods: matchedRoute.methods,
    });
    return jsonResponse(405, {
      error: "Method not allowed for endpoint",
      method: req.method,
      path: proxyPath,
    }, req);
  }

  const service = inferService(proxyPath);
  logGatewayEvent("info", "route.matched", {
    requestId,
    proxyPath,
    methods: matchedRoute.methods,
    service,
  });

  const backendBaseUrl = resolveBackendUrl(service);
  if (!backendBaseUrl) {
    logGatewayEvent("error", "backend.missing-url", {
      requestId,
      service,
      proxyPath,
    });
    return jsonResponse(500, {
      error: "Missing backend URL environment variable for requested service",
      service,
    }, req);
  }

  const requestBody = await buildForwardBody(req);
  const targetUrl = buildTargetUrl(
    backendBaseUrl,
    proxyPath,
    requestUrl.search,
    service,
  );

  logGatewayEvent("info", "proxy.resolved", {
    requestId,
    proxyPath,
    service,
    targetUrl: targetUrl.toString(),
    ...summarizeRequestBody(requestBody),
    ...summarizeBackendUrl(backendBaseUrl),
  });
  return { proxyPath, service, backendBaseUrl, requestBody, targetUrl };
}
