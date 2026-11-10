import { findNearbyStoredBusinesses, normalizeStoredBusiness } from "./stored-businesses.ts"

export function normalizeSupermarketPlace(value: unknown) {
  return normalizeStoredBusiness(value, "supermarket")
}

export function findNearbySupermarkets(latitude: number, longitude: number, radius: number) {
  return findNearbyStoredBusinesses(latitude, longitude, radius, "supermarket")
}
