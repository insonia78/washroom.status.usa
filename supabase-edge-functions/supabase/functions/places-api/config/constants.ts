export const FUNCTION_NAME = "places-api"
export const FUNCTION_BASE_PATH = `/functions/v1/${FUNCTION_NAME}`
export const FUNCTION_PATH_PREFIXES = [FUNCTION_BASE_PATH, `/${FUNCTION_NAME}`]
export const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
] as const
export const OVERPASS_REQUEST_TIMEOUT_MS = 18_000
export const OVERPASS_QUERY_TIMEOUT_SECONDS = 15
export const ZIPPOTAM_URL = "https://api.zippopotam.us"
export const OVERPASS_HEADERS = {
  "User-Agent": "WashroomStatusUSA/1.0 (washroom.status.usa@gmail.com)"
}
export const OVERPASS_CACHE_TTL_MS = 5 * 60 * 1000
export const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept, origin",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
}
export const ANSI_RESET = "\x1b[0m"
export const ANSI_COLORS = {
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m"
} as const
