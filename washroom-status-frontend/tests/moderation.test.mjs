import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isPendingReview,isPendingToilet} from '../lib/moderation.ts';

const review={id:'review-id',osm_type:'node',osm_id:123,rating:4,availability:'open',cleanliness_status:'clean',issues:['odor'],comment:'Needs supplies',created_at:'2026-10-26T18:00:00Z',status:'pending'};
const toilet={id:'toilet-id',name:'Park toilet',latitude:40.7128123,longitude:-74.0060123,wheelchair:'unknown',fee:'no',notes:'Near entrance',status:'pending',created_at:'2026-10-30T18:00:00Z'};

test('toilet moderation accepts exact GPS coordinates and rejects malformed or non-pending rows',()=>{
  assert.equal(isPendingToilet(toilet),true);
  for(const row of [null,{}, {...toilet,latitude:NaN},{...toilet,latitude:73},{...toilet,longitude:-64},
    {...toilet,longitude:'-74'},{...toilet,status:'approved'},{...toilet,fee:'maybe'},{...toilet,created_at:'bad'}]){
    assert.equal(isPendingToilet(row),false);
  }
});

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
