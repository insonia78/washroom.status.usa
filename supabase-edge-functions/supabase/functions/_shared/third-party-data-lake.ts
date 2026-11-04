import { logError } from "../places-api/utils/logger.ts"

const BUCKET = "third-party-api-data-lake"
const MAX_OBJECT_SIZE_BYTES = 10 * 1024 * 1024

export type ThirdPartyProvider = "refuge-restrooms" | "zippopotam"

type ProviderExchange = {
  provider: ThirdPartyProvider
  requestUrl: string
  requestMethod: string
  responseStatus: number | null
  responseContentType: string | null
  responseBody: string | null
  error?: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function archiveProviderExchange(exchange: ProviderExchange): Promise<void> {
  try {
    const baseUrl = Deno.env.get("SUPABASE_URL")
    const apiKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!baseUrl || !apiKey) {
      logError("provider-data-lake", "Could not archive third-party API exchange", {
        provider: exchange.provider,
        reason: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unavailable.",
      })
      return
    }

    const capturedAt = new Date().toISOString()
    const datePath = capturedAt.slice(0, 10).replaceAll("-", "/")
    const objectPath = `${exchange.provider}/${datePath}/${crypto.randomUUID()}.json`
    const payload = JSON.stringify({
      capturedAt,
      provider: exchange.provider,
      request: {
        method: exchange.requestMethod,
        url: exchange.requestUrl,
      },
      response: {
        status: exchange.responseStatus,
        contentType: exchange.responseContentType,
        body: exchange.responseBody,
      },
      ...(exchange.error ? { error: exchange.error } : {}),
    })

    if (new TextEncoder().encode(payload).byteLength > MAX_OBJECT_SIZE_BYTES) {
      logError("provider-data-lake", "Third-party API exchange exceeded archive size limit", {
        provider: exchange.provider,
        limitBytes: MAX_OBJECT_SIZE_BYTES,
      })
      return
    }

    const url = new URL(
      `/storage/v1/object/${BUCKET}/${objectPath}`,
      baseUrl,
    )
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "x-upsert": "false",
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      logError("provider-data-lake", "Third-party API exchange archive upload failed", {
        provider: exchange.provider,
        status: response.status,
      })
    }
  } catch (error) {
    logError("provider-data-lake", "Third-party API exchange archive upload failed", {
      provider: exchange.provider,
      error: getErrorMessage(error),
    })
  }
}

export async function fetchAndArchiveProviderResponse(
  provider: ThirdPartyProvider,
  input: URL,
  init?: RequestInit,
): Promise<Response> {
  const requestUrl = input.href
  const requestMethod = init?.method ?? "GET"
  let response: Response

  try {
    response = await fetch(input, init)
  } catch (error) {
    await archiveProviderExchange({
      provider,
      requestUrl,
      requestMethod,
      responseStatus: null,
      responseContentType: null,
      responseBody: null,
      error: getErrorMessage(error),
    })
    throw error
  }

  let responseBody: string | null = null
  let archiveError: string | undefined
  try {
    responseBody = await response.clone().text()
  } catch (error) {
    archiveError = `Could not read provider response body: ${getErrorMessage(error)}`
  }

  await archiveProviderExchange({
    provider,
    requestUrl,
    requestMethod,
    responseStatus: response.status,
    responseContentType: response.headers.get("content-type"),
    responseBody,
    ...(archiveError ? { error: archiveError } : {}),
  })

  return response
}
