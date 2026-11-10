import { gatewayCallerHeader, gatewaySecretHeader, authorizeGatewayRequest } from "../_shared/gateway-auth.ts";
import { encoder, isJwtCreatorRequestBody, buildTokenRecord, persistTokenRecordIfConfigured } from "./token-record.ts";
import { SignJWT } from "npm:jose@5";
import { requiredDatabaseFields } from "./database-fields.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": `authorization, x-client-info, apikey, content-type, ${gatewayCallerHeader}, ${gatewaySecretHeader}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Creates a JSON response with the function's CORS headers.
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

console.log("JWT Creator function loaded.");
export default {
  // Authenticates the gateway, validates input, signs a JWT, and optionally persists it.
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
    const gatewayAuthorizationError = authorizeGatewayRequest(
      req,
      jsonResponse,
      "jwt-creator",
    );
    if (gatewayAuthorizationError) {
      return gatewayAuthorizationError;
    }
    try {
      const secretKey = Deno.env.get("MY_JWT_SECRET");
      if (!secretKey) {
        throw new Error("Missing MY_JWT_SECRET environment variable.");
      }
      const secret = encoder.encode(secretKey);
      const requestBody = await req.json();
      if (!isJwtCreatorRequestBody(requestBody)) {
        throw new Error("Request body must be a JSON object with optional string userId and role fields.");
      }

      const tokenRecord = await buildTokenRecord(requestBody);
      const jwt = await new SignJWT({
        userId: tokenRecord.userId,
        role: tokenRecord.role,
        sha: tokenRecord.tokenSha
      }).setProtectedHeader({
        alg: "HS256"
      }).setSubject(tokenRecord.userId).setJti(tokenRecord.tokenId).setIssuedAt(tokenRecord.issuedAt).setIssuer(tokenRecord.issuer).setExpirationTime(tokenRecord.expiresAt).sign(secret);
      const tokenPersistence = await persistTokenRecordIfConfigured(tokenRecord);
      return jsonResponse(200, {
        token: jwt,
        tokenRecord,
        tokenPersistence,
        requiredDatabaseFields
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse(400, {
        error: message
      });
    }
  }
};
