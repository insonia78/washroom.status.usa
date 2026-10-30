import assert from 'node:assert/strict';
import {test} from 'node:test';
import {googleMapsDirectionsUrl,googleMapsLocationUrl} from '../lib/navigation.ts';

test('moderator Google Maps location uses the exact GPS point rather than a name or rounded address',()=>{
  const latitude=40.712812345;
  const longitude=-74.006012345;
  const url=new URL(googleMapsLocationUrl(latitude,longitude));
  assert.equal(url.origin,'https://www.google.com');
  assert.equal(url.pathname,'/maps/search/');
  assert.deepEqual(Object.fromEntries(url.searchParams),{api:'1',query:`${latitude},${longitude}`});
});

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
