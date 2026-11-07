import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {layoutProof} from '../web/layout.mjs';
const folder=new URL('../web/examples/',import.meta.url);
const examples=fs.readdirSync(folder).filter(name=>name.endsWith('.json')).map(name=>({name,tree:JSON.parse(fs.readFileSync(new URL(name,folder),'utf8'))}));

test('every bundled checked example is a complete renderable proof tree',()=>{
  assert.equal(examples.length,6);
  for(const {name,tree} of examples){
    assert.equal(tree.kernelChecked,true,name);
    assert.equal(tree.truncated,false,name);
    assert.ok(tree.fixture.sourceUrl.startsWith('https://'),name);
    assert.ok(layoutProof(tree).marks.length>0,name);
  }
});
test('the bundled trees retain their original canonical content fingerprints',()=>{
  const keys=['schema','declaration','statement','displayStatement','parameters','root','nodes','axioms','references','expansions','specialized','truncated','mode','semantics'];
  const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
  for(const {name,tree} of examples){
    const canonical=Object.fromEntries(keys.map(key=>[key,tree[key]]));
    const actual=crypto.createHash('sha256').update(JSON.stringify(ordered(canonical))).digest('hex');
    assert.equal(actual,tree.contract.treeSha256,name);
  }
});
