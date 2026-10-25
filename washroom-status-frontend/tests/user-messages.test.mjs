import assert from 'node:assert/strict';
import {test} from 'node:test';
import {apiFailureMessage} from '../lib/user-messages.ts';

test('API errors identify failed providers without forwarding internal details', () => {
  assert.equal(apiFailureMessage('Refuge Restrooms unavailable. Internal URL: secret'),
    'Refuge Restrooms API request failed. Please try again.');
  assert.equal(apiFailureMessage(null, 'OpenFreeMap API'),
    'OpenFreeMap API request failed. Please try again.');
  assert.equal(apiFailureMessage('Gateway API request failed.'),
    'Gateway API request failed. Please try again.');
  assert.equal(apiFailureMessage('ZIP Geocoding API request failed.'),
    'ZIP Geocoding API request failed. Please try again.');
});
