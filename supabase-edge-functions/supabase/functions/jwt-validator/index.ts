import { gatewayCallerHeader, gatewaySecretHeader, authorizeGatewayRequest } from "../_shared/gateway-auth.ts";
import { supabaseJwtSecret, customJwtSecret, verifyToken, validateCustomTokenAgainstDatabase, getPayloadStringValue } from "./token-validation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": `authorization, x-client-info, apikey, content-type, ${gatewayCallerHeader}, ${gatewaySecretHeader}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Creates a JSON response with the validator's CORS headers.
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

// This endpoint uses 'publishable' | 'secret' access, apiKey is required.
// Use publishable for client-facing, key-validated endpoints.
// Use secret for server-to-server, internal calls.
export default {
  // Authorizes gateway calls, verifies the bearer token, and returns its identity claims.
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders
      });
    }
    if (req.method !== "POST") {
      return jsonResponse(405, {
        error: "Method not allowed",
        method: req.method
      });
    }
    const gatewayAuthorizationError = authorizeGatewayRequest(req, jsonResponse, "jwt-validator");
    if (gatewayAuthorizationError) {
      return gatewayAuthorizationError;
    }
    if (!supabaseJwtSecret && !customJwtSecret) {
      return jsonResponse(500, {
        error: "Missing JWT verification secret configuration"
      });
    }
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(401, {
        error: "Missing or invalid Authorization header"
      });
    }
    const token = authHeader.slice("Bearer ".length);
    const verifiedToken = await verifyToken(token);
    if (!verifiedToken) {
      return jsonResponse(401, {
        error: "Invalid or expired token"
      });
    }

    if (verifiedToken.tokenType === "custom") {
      const databaseValidation = await validateCustomTokenAgainstDatabase(verifiedToken.payload);
      if (!databaseValidation.valid) {
        return jsonResponse(databaseValidation.status, {
          error: databaseValidation.error
        });
      }
    }

    return jsonResponse(200, {
      payload: verifiedToken.payload,
      tokenType: verifiedToken.tokenType,
      databaseValidated: verifiedToken.tokenType === "custom",
      userId: getPayloadStringValue(verifiedToken.payload, "sub"),
      userEmail: getPayloadStringValue(verifiedToken.payload, "email")
    });
  }
};
