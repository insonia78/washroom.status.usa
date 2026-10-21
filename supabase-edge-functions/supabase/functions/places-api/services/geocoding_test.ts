import { RequestError } from "../utils/errors.ts"
import { readRequestInput } from "../utils/request.ts"
import { geocodeZipCode, resolveSearchOrigin } from "./geocoding.ts"

async function expectRequestError(action: () => Promise<unknown>, status: number, message: string) {
  let caughtError: unknown
  try {
    await action()
  } catch (error) {
    caughtError = error
  }
  if (
    !(caughtError instanceof RequestError) ||
    caughtError.status !== status ||
    !caughtError.message.includes(message)
  ) {
    throw new Error(`Expected HTTP ${status} containing '${message}'.`)
  }
}

Deno.test("US ZIP searches use Zippopotam and cache results", async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = (input) => {
    fetchCalls += 1
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.href !== "https://api.zippopotam.us/us/10001") {
      throw new Error("Expected the US ZIP lookup to use Zippopotam only.")
    }
    return Promise.resolve(Response.json({
      places: [{ latitude: "40.75", longitude: "-73.99" }],
    }))
  }

  try {
    const origin = await resolveSearchOrigin({ zip: "10001" })
    if (
      origin.latitude !== 40.75 ||
      origin.longitude !== -73.99 ||
      origin.source !== "zip" ||
      origin.zipCode !== "10001" ||
      origin.countryCode !== "us"
    ) {
      throw new Error("Expected Zippopotam coordinates and the existing search origin shape.")
    }
    const cachedOrigin = await resolveSearchOrigin({ zip: "10001", countryCode: "US" })
    if (cachedOrigin !== origin || fetchCalls !== 1) {
      throw new Error("Expected repeated US ZIP searches to use cached coordinates.")
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test("US ZIP searches report missing ZIPs, upstream errors, and malformed coordinates", async () => {
  const originalFetch = globalThis.fetch
  const cases = [
    { zip: "00000", response: new Response(null, { status: 404 }), status: 400 },
    { zip: "00001", response: new Response("Unavailable", { status: 503 }), status: 502 },
    { zip: "00002", response: Response.json({ places: [] }), status: 400 },
    { zip: "00003", response: Response.json({}), status: 502 },
    { zip: "00004", response: Response.json({ places: [{ latitude: "NaN", longitude: "-73" }] }), status: 502 },
    { zip: "00005", response: Response.json({ places: [{ latitude: "", longitude: "-73" }] }), status: 502 },
    { zip: "00006", response: Response.json({ places: [{ latitude: "91", longitude: "-73" }] }), status: 502 },
  ]
  try {
    for (const testCase of cases) {
      let fetchCalls = 0
      globalThis.fetch = () => {
        fetchCalls += 1
        return Promise.resolve(testCase.response)
      }
      await expectRequestError(
        () => resolveSearchOrigin({ zip: testCase.zip }),
        testCase.status,
        testCase.status === 400 ? "could not be geocoded" : "Zippopotam",
      )
      if (fetchCalls !== 1) {
        throw new Error("Expected a single lookup with no fallback.")
      }
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test("GET and POST reject non-US countries and invalid ZIP formats before fetching", async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = () => {
    fetchCalls += 1
    throw new Error("Invalid inputs must not call an upstream service.")
  }
  try {
    for (const method of ["GET", "POST"]) {
      for (const payload of [
        { zip: "10001", countryCode: "ca" },
        { lat: "40.75", lon: "-73.99", countryCode: "gb" },
        { zip: "K1A 0B1" },
        { zip: "1234" },
        { zip: "10001-1234" },
        { zip: "123456" },
        { zip: "1234a" },
      ]) {
        const url = new URL("https://example.test/bathrooms")
        for (const [key, value] of Object.entries(payload)) {
          url.searchParams.set(key, value)
        }
        const request = method === "GET"
          ? new Request(url)
          : new Request("https://example.test/bathrooms", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        const input = await readRequestInput(request)
        await expectRequestError(
          () => resolveSearchOrigin(input),
          400,
          payload.countryCode ? "Only US searches" : "five-digit US ZIP",
        )
      }
    }
    await expectRequestError(() => geocodeZipCode("10001", "ca"), 400, "Only US searches")
    if (fetchCalls !== 0) {
      throw new Error("Invalid requests must be rejected before fetching.")
    }
    const origin = await resolveSearchOrigin({ lat: "40.75", lon: "-73.99" })
    if (origin.source !== "coordinates" || origin.latitude !== 40.75 || origin.longitude !== -73.99) {
      throw new Error("Coordinate searches must preserve existing behavior.")
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test("ZIP lookup preserves leading zeros", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input) => {
    if (String(input) !== "https://api.zippopotam.us/us/00501") {
      throw new Error("Expected leading zeros to be preserved in the provider request.")
    }
    return Promise.resolve(Response.json({
      places: [{ latitude: "40.81", longitude: "-73.04" }],
    }))
  }
  try {
    const origin = await geocodeZipCode("00501")
    if (origin?.zipCode !== "00501") {
      throw new Error("Expected leading zeros to be preserved in the search origin.")
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
