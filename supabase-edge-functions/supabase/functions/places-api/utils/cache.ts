import { logWithColor } from "./logger.ts"

type CacheEntry<T> = {
  expiresAt: number
  value: T
}

type CacheLookupResult<T> =
  | { found: true; value: T }
  | { found: false }

const cacheStore = new Map<string, CacheEntry<unknown>>()

// Retrieves a cached value while reporting misses and removing expired entries.
export function getCachedValue<T>(cacheName: string, key: string): CacheLookupResult<T> {
  const cacheKey = `${cacheName}:${key}`
  const entry = cacheStore.get(cacheKey)

  if (!entry) {
    logWithColor("cache", "\x1b[90m", `MISS ${cacheName}`, key)
    return { found: false }
  }

  if (entry.expiresAt <= Date.now()) {
    cacheStore.delete(cacheKey)
    logWithColor("cache", "\x1b[90m", `EXPIRED ${cacheName}`, key)
    return { found: false }
  }

  logWithColor("cache", "\x1b[90m", `HIT ${cacheName}`, key)
  return { found: true, value: entry.value as T }
}

// Stores a value with an expiration time based on the supplied TTL.
export function setCachedValue<T>(cacheName: string, key: string, value: T, ttlMs: number) {
  const cacheKey = `${cacheName}:${key}`
  cacheStore.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    value
  })

  logWithColor("cache", "\x1b[90m", `SET ${cacheName} ttl=${ttlMs}ms`, key)
}
