import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceMiles, formatDistance } from '../lib/distance.ts';

test('straight-line distances use miles and the current search origin', () => {
  assert.equal(distanceMiles(40, -83, 40, -83), 0);
  const oneMileLatitude = 1609.344 / 6_371_000 * 180 / Math.PI;
  assert.ok(Math.abs(distanceMiles(0, 0, oneMileLatitude, 0) - 1) < 1e-10);
  assert.ok(Math.abs(distanceMiles(0, 179.999, 0, -179.999) - 0.13819) < 0.0001);
  assert.ok(Number.isFinite(distanceMiles(0, 0, 0, 180)));
  assert.ok(distanceMiles(35.9631, -78.9315, 35.9639225, -78.9470744) < 1);
  assert.ok(distanceMiles(40.0999, -83.0157, 35.9639225, -78.9470744) > 100);
});

test('distance labels distinguish very close places and retain two decimal places', () => {
  assert.equal(formatDistance(0), 'Less than 0.01 mi');
  assert.equal(formatDistance(0.009), 'Less than 0.01 mi');
  assert.equal(formatDistance(0.01), '0.01 mi');
  assert.equal(formatDistance(1), '1.00 mi');
  assert.equal(formatDistance(2.3456), '2.35 mi');
});
