export function googleMapsDirectionsUrl(latitude: number, longitude: number): string {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', `${latitude},${longitude}`);
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}
