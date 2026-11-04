import { fetchAndArchiveProviderResponse } from "./third-party-data-lake.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test("third-party API responses are archived privately by provider and date", async () => {
  const originalFetch = globalThis.fetch
  const originalSupabaseUrl = Deno.env.get("SUPABASE_URL")
  const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  Deno.env.set("SUPABASE_URL", "https://project.example")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
  const uploads: Array<{ url: URL; payload: Record<string, unknown> }> = []

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.startsWith("/storage/v1/object/")) {
      assert(init?.method === "POST", "Upload immutable archive objects")
      assert(
        (init?.headers as Record<string, string>)["x-upsert"] === "false",
        "Do not overwrite existing archive objects",
      )
      uploads.push({
        url,
        payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })
      return Response.json({ Key: url.pathname }, { status: 200 })
    }
    return Response.json([{ id: 1 }], {
      headers: { "content-type": "application/json" },
    })
  }

  try {
    const requestUrl = new URL(
      "https://www.refugerestrooms.org/api/v1/restrooms/by_location?lat=40.75&lng=-73.99&page=1",
    )
    const response = await fetchAndArchiveProviderResponse(
      "refuge-restrooms",
      requestUrl,
    )
    assert(response.ok, "Return the original provider response")
    const upload = uploads[0]
    assert(upload !== undefined, "Upload an archive object")
    assert(
      upload.url.pathname.startsWith(
        "/storage/v1/object/third-party-api-data-lake/refuge-restrooms/",
      ),
      "Store the object in the private data-lake bucket under its provider",
    )
    assert(
      Boolean(upload.url.pathname.match(/\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.json$/)),
      "Partition the archive path by date",
    )
    assert(upload.payload.provider === "refuge-restrooms", "Record the provider")
    const request = upload.payload.request as Record<string, unknown> | undefined
    assert(request?.url === requestUrl.href, "Preserve exact request coordinates and URL")
    const archivedResponse = upload.payload.response as Record<string, unknown> | undefined
    assert(archivedResponse?.status === 200, "Record the provider response status")
    assert(archivedResponse?.body === '[{"id":1}]', "Archive the raw provider response body")
    assert(await response.text() === '[{"id":1}]', "Preserve the original response body for the caller")
  } finally {
    globalThis.fetch = originalFetch
    if (originalSupabaseUrl === undefined) Deno.env.delete("SUPABASE_URL")
    else Deno.env.set("SUPABASE_URL", originalSupabaseUrl)
    if (originalServiceRoleKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY")
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey)
  }
})

Deno.test("third-party archive failures do not replace upstream responses", async () => {
  const originalFetch = globalThis.fetch
  const originalSupabaseUrl = Deno.env.get("SUPABASE_URL")
  const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  Deno.env.set("SUPABASE_URL", "https://project.example")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

  globalThis.fetch = async input => {
    if (new URL(String(input)).pathname.startsWith("/storage/v1/object/")) {
      return new Response("Storage unavailable", { status: 503 })
    }
    return new Response("Provider response", { status: 200 })
  }

  try {
    const response = await fetchAndArchiveProviderResponse(
      "zippopotam",
      new URL("https://api.zippopotam.us/us/10001"),
    )
    assert(response.status === 200, "Keep the provider response when archive upload fails")
    assert(await response.text() === "Provider response", "Keep its response body intact")
  } finally {
    globalThis.fetch = originalFetch
    if (originalSupabaseUrl === undefined) Deno.env.delete("SUPABASE_URL")
    else Deno.env.set("SUPABASE_URL", originalSupabaseUrl)
    if (originalServiceRoleKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY")
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey)
  }
})

Deno.test("third-party HTTP and network failures are archived", async () => {
  const originalFetch = globalThis.fetch
  const originalSupabaseUrl = Deno.env.get("SUPABASE_URL")
  const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  Deno.env.set("SUPABASE_URL", "https://project.example")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
  const archivedRecords: Record<string, unknown>[] = []
  let failProviderRequest = false

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.startsWith("/storage/v1/object/")) {
      archivedRecords.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Response.json({ Key: url.pathname }, { status: 200 })
    }
    if (failProviderRequest) throw new Error("Provider connection failed")
    return new Response("Provider unavailable", { status: 503 })
  }

  try {
    const httpFailure = await fetchAndArchiveProviderResponse(
      "zippopotam",
      new URL("https://api.zippopotam.us/us/10001"),
    )
    assert(httpFailure.status === 503, "Return the provider's HTTP failure")
    assert(await httpFailure.text() === "Provider unavailable", "Preserve the provider error body")
    const httpRecord = archivedRecords[0]
    assert(httpRecord !== undefined, "Archive the failed HTTP response")
    const httpResponse = httpRecord.response as Record<string, unknown>
    assert(httpResponse.status === 503, "Record the failed HTTP status")
    assert(httpResponse.body === "Provider unavailable", "Record the failed HTTP response body")

    failProviderRequest = true
    let caughtError: unknown
    try {
      await fetchAndArchiveProviderResponse(
        "zippopotam",
        new URL("https://api.zippopotam.us/us/10002"),
      )
    } catch (error) {
      caughtError = error
    }
    assert(caughtError instanceof Error, "Preserve the upstream network error")
    const networkRecord = archivedRecords[1]
    assert(networkRecord !== undefined, "Archive the upstream network error")
    const networkResponse = networkRecord.response as Record<string, unknown>
    assert(networkResponse.status === null, "Record the missing HTTP status")
    assert(networkRecord.error === "Provider connection failed", "Record the network error")
  } finally {
    globalThis.fetch = originalFetch
    if (originalSupabaseUrl === undefined) Deno.env.delete("SUPABASE_URL")
    else Deno.env.set("SUPABASE_URL", originalSupabaseUrl)
    if (originalServiceRoleKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY")
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey)
  }
})
