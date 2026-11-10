import { findNearbyStoredBusinesses, normalizeStoredBusiness } from "./stored-businesses.ts"

export function normalizeFuelPlace(value: unknown) {
  return normalizeStoredBusiness(value, "fuel")
}

export function findNearbyFuel(latitude: number, longitude: number, radius: number) {
  return findNearbyStoredBusinesses(latitude, longitude, radius, "fuel")
}
