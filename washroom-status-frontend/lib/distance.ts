export function distanceMiles(originLat: number, originLon: number, lat: number, lon: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const a = Math.sin(radians(lat - originLat) / 2) ** 2 +
    Math.cos(radians(originLat)) * Math.cos(radians(lat)) *
    Math.sin(radians(lon - originLon) / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a)))) / 1609.344;
}

export function formatDistance(miles: number): string {
  return miles < 0.01 ? 'Less than 0.01 mi' : `${miles.toFixed(2)} mi`;
}
