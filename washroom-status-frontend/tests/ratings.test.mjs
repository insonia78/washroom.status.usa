import assert from 'node:assert/strict';
import {test} from 'node:test';
import {starFillPercent} from '../lib/ratings.ts';

test('five-star grades retain fractional averages instead of rounding to full stars',()=>{
  assert.deepEqual([1,2,3,4,5].map(star=>starFillPercent(3.5,star)),[100,100,100,50,0]);
  assert.deepEqual([1,2,3,4,5].map(star=>starFillPercent(5,star)),[100,100,100,100,100]);
  assert.deepEqual([1,2,3,4,5].map(star=>starFillPercent(null,star)),[0,0,0,0,0]);
  assert.equal(starFillPercent(1,1),100);
  assert.equal(starFillPercent(1,2),0);
});
