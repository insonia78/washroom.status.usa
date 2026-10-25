export const LOCATION_RESULTS_ERROR = "Places API request failed. Please try again.";

export function apiFailureMessage(detail: unknown, fallback = 'Places API'): string {
  const text = typeof detail === 'string' ? detail : '';
  const apis = [
    /refuge/i.test(text) ? 'Refuge Restrooms API' : '',
    /openfreemap/i.test(text) ? 'OpenFreeMap API' : '',
    /gateway/i.test(text) ? 'Gateway API' : '',
    /photon/i.test(text) ? 'Photon Geocoding API' : '',
    /zippopotam/i.test(text) ? 'Zippopotam ZIP API' : '',
    /ZIP Geocoding API/i.test(text) ? 'ZIP Geocoding API' : '',
  ].filter(Boolean);
  return `${apis.length ? apis.join(' and ') : fallback} request failed. Please try again.`;
}
