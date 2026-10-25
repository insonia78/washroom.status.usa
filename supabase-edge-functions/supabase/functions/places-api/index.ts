// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.
// Setup type definitions for built-in Supabase Runtime APIs
// import "@supabase/functions-js/edge-runtime.d.ts";

import { handleBathroomsRequest } from "./handlers/bathrooms.ts"
import { authorizeGatewayRequest } from "../_shared/gateway-auth.ts"
import { ANSI_COLORS, corsHeaders } from "./config/constants.ts"
import { RequestError } from "./utils/errors.ts"
import { jsonResponse } from "./utils/http.ts"
import { logError, logWithColor } from "./utils/logger.ts"
import { buildRequestSummary, getRoutePath, readRequestInput } from "./utils/request.ts"

const supportedRoutes = ["/bathrooms"]

console.log("Places API function loaded.")

export default {
  // Handles preflight, gateway authorization, input parsing, route dispatch, and request errors.
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders })
    }

    const gatewayAuthorizationError = authorizeGatewayRequest(
      req,
      jsonResponse,
      "places-api",
    )
    if (gatewayAuthorizationError) {
      return gatewayAuthorizationError
    }

    if (!["GET", "POST"].includes(req.method)) {
      return jsonResponse(405, {
        error: "Method not allowed",
        method: req.method
      })
    }

    const startedAt = Date.now()
    const routePath = getRoutePath(req)
    logWithColor("request", ANSI_COLORS.blue, `${req.method} ${new URL(req.url).pathname}`, buildRequestSummary(req, routePath))

    try {
      const requestInput = await readRequestInput(req)
      let response: Response

      if (routePath === "/" || routePath === "/bathrooms") {
        response = await handleBathroomsRequest(requestInput)
      } else {
        response = jsonResponse(404, {
          error: "Route not found",
          routePath,
          supportedRoutes
        })
      }

      const durationMs = Date.now() - startedAt
      const responseColor = response.status >= 400 ? ANSI_COLORS.red : ANSI_COLORS.green
      logWithColor("response", responseColor, `${req.method} ${new URL(req.url).pathname} -> ${response.status} (${durationMs}ms)`)

      return response
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const status = error instanceof RequestError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)

      logError("places-api", "Function request failed", {
        routePath,
        durationMs,
        error: message
      })

      return jsonResponse(status, {
        success: false,
        error: message
      })
    }
  }
}

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Run `supabase functions serve places-api --env-file supabase/functions/.env`
  3. Call:
     - POST http://127.0.0.1:55321/functions/v1/places-api/bathrooms
       {"zip":"10001","radius":"1500"}

*/
