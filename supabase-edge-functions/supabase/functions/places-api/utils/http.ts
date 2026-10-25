import { corsHeaders } from "../config/constants.ts"

// Serializes an API payload as JSON with the shared CORS headers.
export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  })
}
