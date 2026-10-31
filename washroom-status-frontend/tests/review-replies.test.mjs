import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isAdminReview,isReviewReply} from '../lib/review-replies.ts';

const review={id:'11111111-1111-4111-8111-111111111111',user_id:'22222222-2222-4222-8222-222222222222',
  osm_type:'node',osm_id:123,rating:3,comment:'Review',status:'pending',created_at:'2026-10-31T01:00:00Z'};
const reply={id:'33333333-3333-4333-8333-333333333333',review_id:review.id,recipient_user_id:review.user_id,
  body:'Private reply',status:'draft',created_at:review.created_at,first_attempt_at:null,last_attempt_at:null,sent_at:null};
test('admin reviews support privately linked and historical anonymous reviews',()=>{
  assert.equal(isAdminReview(review),true);
  assert.equal(isAdminReview({...review,user_id:null}),true);
  for(const changes of [{user_id:'email@example.test'},{status:'bad'},{rating:0},{osm_type:'unknown'}]){
    assert.equal(isAdminReview({...review,...changes}),false);
  }
});
test('reply validation distinguishes saved, attempted and provider-accepted states',()=>{
  assert.equal(isReviewReply(reply),true);
  const attempted={...reply,first_attempt_at:review.created_at,last_attempt_at:review.created_at};
  for(const status of ['sending','unknown','failed'])assert.equal(isReviewReply({...attempted,status}),true);
  assert.equal(isReviewReply({...attempted,status:'sent',sent_at:review.created_at}),true);
  assert.equal(isReviewReply({...reply,status:'sent'}),false);
  assert.equal(isReviewReply({...reply,status:'unknown'}),false);
  assert.equal(isReviewReply({...reply,sent_at:review.created_at}),false);
  assert.equal(isReviewReply({...reply,recipient_user_id:null}),true);
});
