export function googleMapsLocationUrl(latitude: number, longitude: number): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', `${latitude},${longitude}`);
  return url.toString();
}

export function googleMapsDirectionsUrl(latitude: number, longitude: number): string {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', `${latitude},${longitude}`);
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}
