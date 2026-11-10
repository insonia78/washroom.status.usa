import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePublicReviews} from '../lib/public-reviews.ts';
import {matchesRestroomFilter} from '../lib/restroom-filters.ts';

const review = {
  id: 'review', rating: 5, availability: null, cleanliness_status: null,
  issues: [], comment: '', created_at: '2026-01-01T00:00:00Z', photo_urls: [],
};
const valid = {reviews: [review], average: 4.5, review_count: 7};

test('cards and details share strict review and grade validation', () => {
  for (const limit of [1, 50]) {
    assert.deepEqual(parsePublicReviews(valid, limit), valid);
    assert.deepEqual(parsePublicReviews({reviews: [], average: null, review_count: 0}, limit),
      {reviews: [], average: null, review_count: 0});
    for (const payload of [
      null, {}, {...valid, review_count: -1}, {...valid, average: NaN},
      {...valid, average: 6}, {...valid, review_count: 0},
      {...valid, reviews: [{...review, rating: 0}]},
      {...valid, reviews: [{...review, created_at: 'invalid'}]},
      {...valid, reviews: [{...review, owner_photo_urls: [3]}]},
      {...valid, reviews: [{...review, photo_urls: undefined}]},
    ]) assert.throws(() => parsePublicReviews(payload, limit));
  }
  assert.throws(() => parsePublicReviews({...valid, reviews: [review, review]}, 1));
  assert.equal(parsePublicReviews({...valid, reviews: [review, review]}, 50).reviews.length, 2);
  assert.throws(() => parsePublicReviews({...valid, reviews: Array(51).fill(review)}, 50));
});

test('map markers and result cards share identical listing filter rules', () => {
  assert.equal(matchesRestroomFilter({}, 'all'), true);
  for (const [filter, field, value] of [
    ['accessible', 'wheelchair', 'yes'], ['free', 'fee', 'no'], ['always', 'opening_hours', '24/7'],
  ]) {
    assert.equal(matchesRestroomFilter({[field]: value}, filter), true);
    assert.equal(matchesRestroomFilter({}, filter), false);
    assert.equal(matchesRestroomFilter({[field]: 'unknown'}, filter), false);
  }
  assert.equal(matchesRestroomFilter({}, 'unsupported'), false);
});
