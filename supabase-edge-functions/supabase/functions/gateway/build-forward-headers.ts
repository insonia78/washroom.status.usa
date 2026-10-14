export function buildForwardHeaders(
  req: Request,
  payload: Record<string, unknown>,
  tokenType: "supabase" | "custom",
) {
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");

  const userId = getPayloadStringValue(payload, "sub");
  if (userId) {
    headers.set("X-User-Id", userId);
  }

  headers.set("X-User-Type", tokenType);
  headers.set("X-User-Payload", JSON.stringify(payload));
  const gatewayCaller = req.headers.get("x-weather-gateway-caller");
  const gatewaySecret = req.headers.get("x-weather-gateway-secret");
  if (gatewayCaller) {
    headers.set("x-weather-gateway-caller", gatewayCaller);
  }
  if (gatewaySecret) {
    headers.set("x-weather-gateway-secret", gatewaySecret);
  }
  return headers;
}

function getPayloadStringValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}
