export type VerifiedToken = {
  payload: Record<string, unknown>;
  tokenType: "supabase" | "custom";
};

// Creates the gateway's JSON response with CORS headers.
export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Content-Type": "application/json"
    }
  });
}

// Checks whether a value is a non-null object record.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Validates the payload shape returned by the JWT validator.
export function isVerifiedToken(value: unknown): value is VerifiedToken {
  if (!isRecord(value)) {
    return false;
  }

  return isRecord(value.payload) && (value.tokenType === "supabase" || value.tokenType === "custom");
}
