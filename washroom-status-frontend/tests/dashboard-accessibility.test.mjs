import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {restroomLabel} from '../lib/restroom-label.ts';

test('listing labels do not reveal providers or source identities',()=>{
  for(const listing of [
    {id:12345,osm_type:'node'},
    {id:67890,osm_type:'refuge',source:'refuge-restrooms'},
  ]){
    const original={...listing};
    assert.equal(restroomLabel(listing),'Restroom listing');
    assert.deepEqual(listing,original);
  }
});

test('business labels retain categories without claiming unknown restroom access',()=>{
  for(const [category,label] of [['fuel','Gas station'],['supermarket','Supermarket']]){
    assert.equal(restroomLabel({category,toilets:'yes'}),`${label} · Toilets listed`);
    assert.equal(restroomLabel({category,toilets:'no'}),`${label} · No toilets listed`);
    for(const toilets of [undefined,'unknown']){
      assert.equal(restroomLabel({category,toilets}),`${label} · Restroom availability unconfirmed`);
    }
  }
});

test('dashboard dialogs share labelled native-modal focus management',async()=>{
  for(const name of ['RestroomDetails','ContributionStart','ReviewModal','AddToiletModal']){
    const source=await readFile(new URL(`../components/${name}.tsx`,import.meta.url),'utf8');
    assert.match(source,/const dialog=useModalDialog\(\)/);
    assert.match(source,/<dialog ref=\{dialog\} aria-labelledby=\{titleId\}/);
    assert.match(source,/public-dialog/);
    assert.match(source,/event\.key==='Escape'/);
    assert.doesNotMatch(source,/Refuge Restrooms|OpenStreetMap/);
  }
});

test('photo removal controls identify the specific attachment',async()=>{
  const source=await readFile(new URL('../components/PhotoPicker.tsx',import.meta.url),'utf8');
  assert.match(source,/aria-label=\{`Remove photo \$\{index\+1\}: \$\{photo\.name\}`\}/);
});
