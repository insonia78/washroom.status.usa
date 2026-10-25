import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requestCurrentPosition} from '../lib/geolocation.ts';

test('successful GPS lookup uses the current coordinates without a fallback', async () => {
  const position = {coords: {latitude: 40, longitude: -83}};
  const calls = [];
  const geolocation = {getCurrentPosition(success, _error, options) {
    calls.push(options);
    success(position);
  }};
  assert.equal(await requestCurrentPosition(geolocation, () => true), position);
  assert.deepEqual(calls, [{enableHighAccuracy: true, timeout: 15000, maximumAge: 60000}]);
});

test('GPS timeout or unavailability retries with lower accuracy', async () => {
  for (const code of [2, 3]) {
    const position = {coords: {latitude: 40, longitude: -83}};
    const calls = [];
    const geolocation = {getCurrentPosition(success, error, options) {
      calls.push(options);
      if (calls.length === 1) error({code, PERMISSION_DENIED: 1});
      else success(position);
    }};
    assert.equal(await requestCurrentPosition(geolocation, () => true), position);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], {enableHighAccuracy: false, timeout: 15000, maximumAge: 60000});
  }
});

test('permission denial and superseded requests do not trigger fallback', async () => {
  for (const [code, current] of [[1, true], [3, false]]) {
    let calls = 0;
    const failure = {code, PERMISSION_DENIED: 1};
    const geolocation = {getCurrentPosition(_success, error) {calls++; error(failure);}};
    await assert.rejects(requestCurrentPosition(geolocation, () => current), error => error === failure);
    assert.equal(calls, 1);
  }
});

test('fallback failures remain explicit errors', async () => {
  let calls = 0;
  const failure = {code: 2, PERMISSION_DENIED: 1};
  const geolocation = {getCurrentPosition(_success, error) {calls++; error(failure);}};
  await assert.rejects(requestCurrentPosition(geolocation, () => true), error => error === failure);
  assert.equal(calls, 2);
});
