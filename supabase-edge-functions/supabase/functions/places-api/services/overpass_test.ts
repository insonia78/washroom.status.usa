import { OVERPASS_REQUEST_TIMEOUT_MS, OVERPASS_URLS } from "../config/constants.ts"
import { RequestError } from "../utils/errors.ts"
import { buildOverpassQuery, fetchOverpassData } from "./overpass.ts"

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test("Overpass bounds stalled requests, retries, and caches only complete results", async (t) => {
  const originalFetch = globalThis.fetch
  const originalTimeout = AbortSignal.timeout
  const deadlines: number[] = []
  AbortSignal.timeout = (milliseconds) => {
    deadlines.push(milliseconds)
    return originalTimeout(5)
  }
  const stall = (signal: AbortSignal) => new Promise<Response>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })

  try {
    await t.step("43085 retries a stalled primary and caches a confirmed empty result", async () => {
      const query = buildOverpassQuery(40.0999, -83.0157, "1000", "bathrooms")
      assert(query.includes("[timeout:15]"), "Server query must allow 15 seconds within the 18 second client deadline")
      let calls = 0
      globalThis.fetch = (input, init) => {
        assert(init?.signal instanceof AbortSignal, "Every attempt needs an abort signal")
        const url = new URL(String(input))
        assert(url.origin === new URL(OVERPASS_URLS[calls]).origin, "Retry the independent fallback")
        assert(init.method === "POST" && init.body instanceof URLSearchParams &&
          init.body.get("data") === query, "Send the restroom query as a form POST")
        calls++
        return calls === 1 ? stall(init.signal) : Promise.resolve(Response.json({ elements: [] }))
      }
      assert((await fetchOverpassData(query)).length === 0, "Confirmed no matches is a valid result")
      assert((await fetchOverpassData(query)).length === 0 && calls === 2, "Cache successful empty results")
      assert(OVERPASS_REQUEST_TIMEOUT_MS === 18_000 &&
        deadlines.length === 2 && deadlines.every(value => value === 18_000),
        "Each endpoint must use an 18 second deadline")
    })

    await t.step("the deadline also covers a stalled response body", async () => {
      let calls = 0
      globalThis.fetch = (_input, init) => {
        const signal = init?.signal
        assert(signal instanceof AbortSignal, "Missing body deadline")
        calls++
        if (calls > 1) return Promise.resolve(Response.json({ elements: [] }))
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            signal.addEventListener("abort", () => controller.error(signal.reason), { once: true })
          },
        })))
      }
      assert((await fetchOverpassData("stalled-body")).length === 0 && calls === 2,
        "Abort stalled JSON reading and retry the independent endpoint")
    })

    await t.step("all stalled endpoints return 504 instead of an empty success", async () => {
      let calls = 0
      globalThis.fetch = (_input, init) => {
        assert(init?.signal instanceof AbortSignal, "Missing network deadline")
        calls++
        return stall(init.signal)
      }
      try {
        await fetchOverpassData("all-stalled")
        throw new Error("Expected timeout failure")
      } catch (error) {
        assert(error instanceof RequestError && error.status === 504, "Return an explicit timeout")
        assert(calls === OVERPASS_URLS.length, "Bound retries to configured endpoints")
      }
    })

    await t.step("HTTP failures, missing elements, and partial timeout results are not cached", async () => {
      for (const [index, makeResponse] of [
        () => new Response("unavailable", { status: 503 }),
        () => Response.json({}),
        () => Response.json({ elements: [], remark: "runtime error: Query timed out" }),
      ].entries()) {
        let calls = 0
        globalThis.fetch = () => { calls++; return Promise.resolve(makeResponse()) }
        const query = `bad-result-${index}`
        try {
          await fetchOverpassData(query)
          throw new Error("Expected provider error")
        } catch (error) {
          assert(error instanceof RequestError && error.status === 502, "Invalid results must fail explicitly")
          assert(calls === OVERPASS_URLS.length, "Try fallback before returning error")
        }
        globalThis.fetch = () => {
          calls++
          return Promise.resolve(Response.json({
            elements: [{ id: 123, type: "node", lat: 40.1, lon: -83.01 }],
          }))
        }
        assert((await fetchOverpassData(query))[0]?.id === 123, "Failure must not poison the result cache")
        assert(calls === OVERPASS_URLS.length + 1, "Retry network after a failed lookup")
      }
    })
  } finally {
    globalThis.fetch = originalFetch
    AbortSignal.timeout = originalTimeout
  }
})
