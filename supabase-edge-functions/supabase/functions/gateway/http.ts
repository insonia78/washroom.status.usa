import { defaultCorsHeaders } from "./config.ts";
import { summarizeBodyPayload } from "./logging.ts";

// Determines whether HTTP semantics allow a response body for this method and status.
export function canResponseHaveBody(method: string, status: number) {
  return method !== "HEAD" && ![101, 103, 204, 205, 304].includes(status);
}

// Builds CORS headers using the request origin and requested header list when present.
export function buildCorsHeaders(req?: Request) {
  const requestOrigin = req?.headers.get("origin");
  const requestedHeaders = req?.headers.get("access-control-request-headers");

  return {
    ...defaultCorsHeaders,
    "Access-Control-Allow-Origin": requestOrigin ??
      defaultCorsHeaders["Access-Control-Allow-Origin"],
    "Access-Control-Allow-Headers": requestedHeaders ??
      defaultCorsHeaders["Access-Control-Allow-Headers"],
    Vary: "Origin, Access-Control-Request-Headers",
  };
}

// Serializes a JSON gateway response with request-specific CORS headers.
export function jsonResponse(status: number, body: unknown, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

// Decodes a backend response as JSON when possible, otherwise as text.
export async function parseBackendBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  return await response.text();
}

// Detects response content types that must be relayed without parsing.
export function shouldProxyRawResponseBody(contentType: string) {
  return contentType.includes("text/event-stream") ||
    contentType.startsWith("image/") ||
    contentType.includes("application/octet-stream");
}

// Summarizes a proxied response without inspecting binary or streaming content.
export function summarizeProxiedBody(
  contentType: string,
  rawResponseBody: boolean,
  body: unknown,
) {
  if (rawResponseBody) {
    return {
      responseShape: contentType.includes("text/event-stream")
        ? "stream"
        : "binary",
    };
  }

  return summarizeBodyPayload(body);
}

// Preserves backend response headers and overlays gateway CORS headers.
export function buildResponseHeaders(sourceHeaders: Headers, req?: Request) {
  const responseHeaders = new Headers(sourceHeaders);
  Object.entries(buildCorsHeaders(req)).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });
  return responseHeaders;
}

// Reconstructs the backend response while respecting status and body type.
export function buildProxiedResponse(
  req: Request,
  status: number,
  headers: Headers,
  body: unknown,
) {
  if (!canResponseHaveBody(req.method, status)) {
    headers.delete("content-length");
    headers.delete("content-type");
    return new Response(null, {
      status,
      headers,
    });
  }

  if (typeof body === "string") {
    return new Response(body, {
      status,
      headers,
    });
  }

  if (
    body instanceof ReadableStream || body instanceof Uint8Array ||
    body instanceof ArrayBuffer || body instanceof Blob
  ) {
    return new Response(body as BodyInit, {
      status,
      headers,
    });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}
