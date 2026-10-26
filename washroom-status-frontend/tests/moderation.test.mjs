import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPendingReview} from '../lib/moderation.ts';

const review={id:'review-id',osm_type:'node',osm_id:123,rating:4,availability:'open',cleanliness_status:'clean',issues:['odor'],comment:'Needs supplies',created_at:'2026-10-26T18:00:00Z',status:'pending'};

test('moderation queue accepts full questionnaires and older reviews with unknown answers',()=>{
  assert.equal(isPendingReview(review),true);
  assert.equal(isPendingReview({...review,availability:null,cleanliness_status:null}),true);
  for(const osm_type of ['node','way','relation','refuge']){
    assert.equal(isPendingReview({...review,osm_type}),true);
  }
});
test('moderation queue rejects malformed, published or invalid rating rows',()=>{
  for(const value of [null,{}, {...review,status:'approved'},{...review,rating:6},{...review,rating:2.5},
    {...review,created_at:'not a date'},{...review,issues:[1]},{...review,osm_type:'unknown'}]){
    assert.equal(isPendingReview(value),false);
  }
});
