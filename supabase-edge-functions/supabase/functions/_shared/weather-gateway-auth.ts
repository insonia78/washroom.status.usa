export const weatherGatewayCallerHeader = "x-weather-gateway-caller";
export const weatherGatewaySecretHeader = "x-weather-gateway-secret";
export const weatherGatewayAuthorizationHeader = "x-weather-gateway-authorization";
export const weatherGatewayCallerValue = "weather-gateway";
export function buildWeatherGatewayHeaders(secret) {
  return {
    [weatherGatewayCallerHeader]: weatherGatewayCallerValue,
    [weatherGatewaySecretHeader]: secret
  };
}
export function authorizeWeatherGatewayRequest(req, jsonResponse, functionName) {
  const internalSecret = Deno.env.get("WEATHER_GATEWAY_INTERNAL_SECRET");
  if (!internalSecret) {
    return jsonResponse(500, {
      error: "Missing WEATHER_GATEWAY_INTERNAL_SECRET environment variable",
      functionName
    });
  }
  if (req.headers.get(weatherGatewayCallerHeader) !== weatherGatewayCallerValue) {
    return jsonResponse(403, {
      error: `${functionName} only accepts requests from weather-gateway`
    });
  }
  if (req.headers.get(weatherGatewaySecretHeader) !== internalSecret) {
    return jsonResponse(403, {
      error: `Invalid weather-gateway authorization for ${functionName}`
    });
  }
  return null;
}
