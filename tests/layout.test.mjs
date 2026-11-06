import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutProof,svgDocument} from '../web/layout.mjs';

const data={schema:'proof-tree/v1',root:0,declaration:'P<&"',displayStatement:'A → B',semantics:'Expression tree',mode:'raw',axioms:[],nodes:[
  {id:0,rule:'intro',children:[1],term:'',type:'',detail:''},
  {id:1,rule:'app',children:[2,3],term:'',type:'',detail:''},
  {id:2,rule:'hypothesis',children:[],term:'',type:'',detail:''},
  {id:3,rule:'hypothesis',children:[],term:'',type:'',detail:''}
]};

test('conclusion is below every premise and is narrower than the level above',()=>{
  const l=layoutProof(data,{width:800,height:600});
  const byId=new Map(l.marks.map(x=>[x.id,x]));
  for(const node of data.nodes)for(const child of node.children)assert.ok(byId.get(node.id).y>byId.get(child).y);
  assert.ok(byId.get(0).x2-byId.get(0).x1<byId.get(1).x2-byId.get(1).x1);
  for(const m of l.marks)assert.ok(m.x1>=0&&m.x2<=l.width&&m.y>=0&&m.y<=l.height);
});
test('vector export escapes labels and records incomplete scope',()=>{
  const svg=svgDocument({...data,truncated:true},layoutProof(data));
  assert.ok(svg.includes('P&lt;&amp;&quot;'));
  assert.ok(svg.includes('TRUNCATED'));
  assert.ok(svg.includes('<metadata>'));
  assert.equal((svg.match(/<path d="M/g)||[]).length,7); // Four proof marks, three legend marks.
});
test('cycles, missing nodes and unsafe color strings are rejected',()=>{
  assert.throws(()=>layoutProof({...data,nodes:[{children:[0]}]}),/Cyclic/);
  assert.throws(()=>layoutProof({...data,root:20}),/Invalid child/);
  assert.throws(()=>svgDocument(data,layoutProof(data),{palette:{intro:'" onload="x'}}),/palette/);
});
test('contracted SVG metadata is independent of object key insertion order',()=>{
  const a={...data,contract:{treeSha256:'same',options:{b:2,a:1}}};
  const b={...data,contract:{options:{a:1,b:2},treeSha256:'same'}};
  assert.equal(svgDocument(a,layoutProof(a)),svgDocument(b,layoutProof(b)));
});
