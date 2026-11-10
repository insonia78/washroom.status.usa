import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";
import { gatewayInternalSecret, jwtCreatorUrl } from "./config.ts";
import { getRecordStringValue } from "./account-payload.ts";

// Requests a signed custom JWT for an authenticated identity.
export async function createJwtForIdentity(
  req: Request,
  identity: { userId: string; role: string },
) {
  if (!jwtCreatorUrl) {
    throw new Error("Missing JWT_CREATOR_URL environment variable.");
  }

  if (!gatewayInternalSecret) {
    throw new Error(
      "Missing GATEWAY_INTERNAL_SECRET required for JWT creator forwarding.",
    );
  }

  const jwtCreatorHeaders = new Headers({
    "Content-Type": "application/json",
  });
  const apiKey = req.headers.get("apikey");
  if (apiKey) {
    jwtCreatorHeaders.set("apikey", apiKey);
  }

  const gatewayHeaders = buildGatewayHeaders(gatewayInternalSecret);
  Object.entries(gatewayHeaders).forEach(([key, value]) => {
    jwtCreatorHeaders.set(key, value);
  });

  const jwtResponse = await fetch(jwtCreatorUrl, {
    method: "POST",
    headers: jwtCreatorHeaders,
    body: JSON.stringify(identity),
  });

  if (!jwtResponse.ok) {
    throw new Error(
      `Failed to obtain JWT from JWT_CREATOR_URL: ${jwtResponse.status} ${jwtResponse.statusText}`,
    );
  }

  const jwtPayload = await jwtResponse.json();
  if (
    typeof jwtPayload !== "object" || jwtPayload === null ||
    Array.isArray(jwtPayload)
  ) {
    throw new Error("JWT creator returned an invalid response payload.");
  }

  const token = getRecordStringValue(
    jwtPayload as Record<string, unknown>,
    "token",
  );
  if (!token) {
    throw new Error("JWT creator response did not include a token.");
  }

  return jwtPayload as Record<string, unknown>;
}

// Adds a custom JWT to successful account responses when identity details are available.
export async function appendTokenForAccountRoutes(
  req: Request,
  payload: unknown,
) {
  if (
    !jwtCreatorUrl ||
    !(payload && typeof payload === "object" && !Array.isArray(payload))
  ) {
    return payload;
  }

  const accountPayload = payload as Record<string, unknown>;
  const accountEmail = typeof accountPayload.email === "string"
    ? accountPayload.email.trim()
    : "";
  const accountRole = getRecordStringValue(accountPayload, "role") || "user";
  if (!accountEmail) {
    return payload;
  }

  const jwtPayload = await createJwtForIdentity(req, {
    userId: accountEmail,
    role: accountRole,
  });
  return {
    ...payload,
    token: getRecordStringValue(jwtPayload, "token"),
  };
}
