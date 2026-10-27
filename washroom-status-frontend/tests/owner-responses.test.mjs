import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isEvidenceUrl,isOwnerResponse,isAdminOwnerResponse} from '../lib/owner-responses.ts';

const row={id:'response-id',osm_type:'refuge',osm_id:123,review_id:null,business_name:'Business',body:'Restocked supplies',
  completed_on:'2026-01-01',evidence_url:'https://example.com/evidence',published_at:'2026-10-26T20:00:00Z'};
test('owner responses support every listing source and optional improvement details',()=>{
  for(const osm_type of ['node','way','relation','refuge'])assert.equal(isOwnerResponse({...row,osm_type}),true);
  assert.equal(isOwnerResponse({...row,completed_on:null,evidence_url:null}),true);
});
test('owner evidence URLs cannot execute scripts or embed credentials',()=>{
  assert.equal(isEvidenceUrl('https://example.com/photos'),true);
  for(const url of ['javascript:alert(1)','data:text/html,test','http://example.com','https://user:pass@example.com','not a URL',null]){
    assert.equal(isEvidenceUrl(url),false);
    assert.equal(isOwnerResponse({...row,evidence_url:url}),url===null);
  }
});
test('admin responses require private verification, version, status and valid timestamps',()=>{
  const draft={...row,published_at:null,verification_note:'Verified owner offline',status:'draft',version:1,updated_at:'2026-10-26T20:00:00Z'};
  assert.equal(isAdminOwnerResponse(draft),true);
  assert.equal(isAdminOwnerResponse({...draft,status:'published',published_at:row.published_at}),true);
  for(const value of [row,{...draft,version:0},{...draft,status:'pending'},{...draft,published_at:row.published_at},
    {...draft,updated_at:'bad'},{...draft,status:'published'},{...draft,osm_type:'bad'}])assert.equal(isAdminOwnerResponse(value),false);
});
