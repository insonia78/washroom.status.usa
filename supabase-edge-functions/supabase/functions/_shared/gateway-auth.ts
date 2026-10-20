export const gatewayCallerHeader = "x-washroom-gateway-caller";
export const gatewaySecretHeader = "x-washroom-gateway-secret";
export const gatewayAuthorizationHeader = "x-washroom-gateway-authorization";
export const gatewayCallerValue = "washroom-gateway";
export const gatewayInternalSecretEnv = "GATEWAY_INTERNAL_SECRET";
export function buildGatewayHeaders(secret: string): Record<string, string> {
  return {
    [gatewayCallerHeader]: gatewayCallerValue,
    [gatewaySecretHeader]: secret
  };
}
export function authorizeGatewayRequest(
  req: Request,
  jsonResponse: (status: number, body: unknown) => Response,
  functionName: string,
): Response | null {
  const internalSecret = Deno.env.get(gatewayInternalSecretEnv);
  if (!internalSecret) {
    return jsonResponse(500, {
      error: `Missing ${gatewayInternalSecretEnv} environment variable`,
      functionName
    });
  }
  if (req.headers.get(gatewayCallerHeader) !== gatewayCallerValue) {
    return jsonResponse(403, {
      error: `${functionName} only accepts requests from the washroom gateway`
    });
  }
  if (req.headers.get(gatewaySecretHeader) !== internalSecret) {
    return jsonResponse(403, {
      error: `Invalid washroom gateway authorization for ${functionName}`
    });
  }
  return null;
}