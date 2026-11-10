import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fetchLatestReview} from '../lib/review-request-queue.ts';
import {observeReview} from '../lib/observe-review.ts';

test('review visibility defers activation until intersecting and disconnects on cleanup', () => {
  const original = globalThis.IntersectionObserver;
  let notify;
  let disconnected = 0;
  let activated = 0;
  const element = {};
  globalThis.IntersectionObserver = class {
    constructor(callback, options) {
      notify = callback;
      assert.equal(options.rootMargin, '100px');
    }
    observe(target) {assert.equal(target, element);}
    disconnect() {disconnected++;}
  };
  try {
    const cleanup = observeReview(element, () => activated++);
    assert.equal(activated, 0, 'No offscreen request');
    notify([{isIntersecting: false}]);
    assert.equal(activated, 0);
    notify([{isIntersecting: true}]);
    assert.equal(activated, 1);
    assert.equal(disconnected, 1);
    cleanup();
    assert.equal(disconnected, 2);
    delete globalThis.IntersectionObserver;
    observeReview(element, () => activated++);
    assert.equal(activated, 2, 'Older browsers still load reviews');
  } finally {globalThis.IntersectionObserver = original;}
});

test('review queue limits concurrent fetches to four and cancels queued work', async () => {
  const original = globalThis.fetch;
  const waiting = [];
  let active = 0;
  let peak = 0;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    return new Promise(resolve => waiting.push(() => {
      active--;
      resolve(Response.json({reviews: []}));
    }));
  };
  const controllers = Array.from({length: 12}, () => new AbortController());
  try {
    const results = controllers.map((controller, i) =>
      fetchLatestReview(`/api/reviews?id=${i}`, controller.signal).catch(error => error));
    assert.equal(calls, 4);
    controllers[10].abort();
    controllers[11].abort();
    while (waiting.length) {
      waiting.shift()();
      await new Promise(resolve => setImmediate(resolve));
    }
    const values = await Promise.all(results);
    assert.equal(calls, 10, 'Aborted queued requests never fetch');
    assert.equal(peak, 4);
    assert.equal(values[10].name, 'AbortError');
    assert.deepEqual(values[0], {reviews: []});
    globalThis.fetch = async () => Response.json({error: 'Unavailable'}, {status: 503});
    await assert.rejects(fetchLatestReview('/api/reviews', new AbortController().signal), /Unavailable/);
    globalThis.fetch = async () => Response.json({reviews: []});
    assert.deepEqual(await fetchLatestReview('/api/reviews', new AbortController().signal), {reviews: []});
  } finally {globalThis.fetch = original;}
});
