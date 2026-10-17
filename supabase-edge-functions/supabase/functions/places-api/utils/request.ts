import { FUNCTION_PATH_PREFIXES } from "../config/constants.ts"
import type { PlacesApiRequestInput } from "../models/types.ts"
import { RequestError } from "./errors.ts"

export function getSearchParamValue(searchParams: URLSearchParams, key: string): string | undefined {
  const values = searchParams.getAll(key)
  if (!values.length) {
    return undefined
  }

  const value = values[0]?.trim()
  return value ? value : undefined
}

function normalizeStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmedValue = value.trim()
  return trimmedValue ? trimmedValue : undefined
}

export async function readRequestInput(req: Request): Promise<PlacesApiRequestInput> {
  if (req.method === "GET") {
    const searchParams = new URL(req.url).searchParams

    return {
      lat: getSearchParamValue(searchParams, "lat"),
      lon: getSearchParamValue(searchParams, "lon"),
      zip: getSearchParamValue(searchParams, "zip"),
      countryCode: getSearchParamValue(searchParams, "countryCode"),
      radius: getSearchParamValue(searchParams, "radius"),
      mode: getSearchParamValue(searchParams, "mode")
    }
  }

  const contentType = req.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new RequestError(400, "POST requests must use 'Content-Type: application/json'.")
  }

  let body: unknown

  try {
    body = await req.json()
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.")
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new RequestError(400, "Request body must be a JSON object.")
  }

  const payload = body as Record<string, unknown>

  return {
    lat: normalizeStringValue(payload.lat),
    lon: normalizeStringValue(payload.lon),
    zip: normalizeStringValue(payload.zip),
    countryCode: normalizeStringValue(payload.countryCode),
    radius: normalizeStringValue(payload.radius),
    mode: normalizeStringValue(payload.mode)
  }
}

export function parseFiniteNumber(value: string, fieldName: string): number {
  const parsedValue = Number.parseFloat(value)

  if (!Number.isFinite(parsedValue)) {
    throw new RequestError(400, `Invalid '${fieldName}' value. Expected a number.`)
  }

  return parsedValue
}

export function getRoutePath(req: Request): string {
  const pathname = new URL(req.url).pathname

  for (const prefix of FUNCTION_PATH_PREFIXES) {
    if (pathname === prefix) {
      return "/"
    }

    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length)
    }
  }

  return pathname
}

export function buildRequestSummary(req: Request, routePath: string) {
  const requestUrl = new URL(req.url)

  return {
    method: req.method,
    pathname: requestUrl.pathname,
    routePath,
    search: requestUrl.search
  }
}
