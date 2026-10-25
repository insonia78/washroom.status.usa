import assert from 'node:assert/strict';
import {test} from 'node:test';
import {googleMapsDirectionsUrl} from '../lib/navigation.ts';

test('Google Maps directions use the same destination without an API key or fixed origin', () => {
  for (const [latitude, longitude] of [[39.9526, -75.1652], [21.3099, -157.8581], [0, 0]]) {
    const url = new URL(googleMapsDirectionsUrl(latitude, longitude));
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/dir/');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      api: '1', destination: `${latitude},${longitude}`, travelmode: 'driving',
    });
  }
});
