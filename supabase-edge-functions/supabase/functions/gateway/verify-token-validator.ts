import { buildWeatherGatewayHeaders } from "../_shared/weather-gateway-auth.ts";
import type { VerifiedToken } from "./utils.ts";
import { isRecord, isVerifiedToken } from "./utils.ts";

const gatewayInternalSecret = Deno.env.get("WEATHER_GATEWAY_INTERNAL_SECRET");
const jwtValidatorUrl = Deno.env.get("JWT_VALIDATOR_URL");

type JsonResponse = (status: number, body: unknown, req?: Request) => Response;

export async function verifyTokenWithValidator(
  req: Request,
  jsonResponse: JsonResponse,
): Promise<{ verifiedToken: VerifiedToken | null; errorResponse: Response | null }> {
  const apiKey = req.headers.get("apikey");
  if (!apiKey) {
    return {
      verifiedToken: null,
      errorResponse: jsonResponse(401, {
        error: "Missing apikey header required for jwt-validator",
      }, req),
    };
  }

  const authorization = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authorization) {
    return {
      verifiedToken: null,
      errorResponse: jsonResponse(401, {
        error: "Missing Authorization header required for weather routes",
      }, req),
    };
  }

  if (!jwtValidatorUrl) {
    return {
      verifiedToken: null,
      errorResponse: jsonResponse(500, {
        error: "Missing JWT_VALIDATOR_URL environment variable",
      }, req),
    };
  }

  if (!gatewayInternalSecret) {
    return {
      verifiedToken: null,
      errorResponse: jsonResponse(500, {
        error: "Missing WEATHER_GATEWAY_INTERNAL_SECRET environment variable",
      }, req),
    };
  }

  let validatorResponse: Response;
  try {
    validatorResponse = await fetch(jwtValidatorUrl, {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: authorization,
        ...buildWeatherGatewayHeaders(gatewayInternalSecret),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      verifiedToken: null,
      errorResponse: jsonResponse(502, {
        error: "Failed to reach jwt-validator",
        details: message,
      }, req),
    };
  }

  let responseBody: unknown = null;
  try {
    responseBody = await validatorResponse.json();
  } catch {
    responseBody = null;
  }

  if (!validatorResponse.ok) {
    return {
      verifiedToken: null,
      errorResponse: jsonResponse(
        validatorResponse.status,
        isRecord(responseBody)
          ? responseBody
          : { error: "jwt-validator rejected the token" },
        req,
      ),
    };
  }

  if (!isVerifiedToken(responseBody)) {
    return {
      verifiedToken: null,
      errorResponse: jsonResponse(502, {
        error: "jwt-validator returned an invalid response payload",
      }, req),
    };
  }

  return {
    verifiedToken: responseBody,
    errorResponse: null,
  };
}
