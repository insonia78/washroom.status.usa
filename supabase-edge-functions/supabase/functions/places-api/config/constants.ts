export const FUNCTION_NAME = "places-api"
export const FUNCTION_BASE_PATH = `/functions/v1/${FUNCTION_NAME}`
export const FUNCTION_PATH_PREFIXES = [FUNCTION_BASE_PATH, `/${FUNCTION_NAME}`]
export const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
] as const
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
export const ZIPPOTAM_URL = "https://api.zippopotam.us"
export const OVERPASS_HEADERS = {
  "User-Agent": "NodeJSExpressRestroomFinder/1.0 (washroom.status.usa@gmail.com)"
}
export const NOMINATIM_HEADERS = {
  "User-Agent": "NodeJSExpressRestroomFinder/1.0 (washroom.status.usa@gmail.com)"
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
