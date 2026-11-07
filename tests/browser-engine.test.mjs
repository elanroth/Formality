import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeBrowserDriver} from '../web/browser-engine.mjs';
const exporter=fs.readFileSync(new URL('../lean/Exporter.lean',import.meta.url),'utf8');
const cfg={declaration:'Demo.test',mode:'compact',expand:['Demo.helper'],expandDepth:1,maxNodes:1000,maxDepth:100,maxVisits:500000,normalize:false,specialize:[['n',4]]};
test('browser driver calls the shared Lean API without native paths or custom command syntax',()=>{
 const code=makeBrowserDriver('theorem sample : True := True.intro',['Std'],cfg,exporter);
 assert.match(code,/import Lean\npublic meta import Lean.Meta.Reduce\nimport Std/);assert.match(code,/ProofTreeTool.exportDeclaration cfg/);
 assert.doesNotMatch(code,/findOLean|elab "#proof_tree/);assert.match(code,/run_elab do/);
 assert.match(code,/\("n",4\)/);assert.match(code,/meta section/);
});
test('source remains literal Lean and options are quoted as Lean strings',()=>{
 const source='-- quoted "source"\ntheorem Demo.test : True := by trivial';
 const code=makeBrowserDriver(source,[],cfg,exporter);
 assert.ok(code.includes(source));assert.ok(code.includes('expand := #["Demo.helper"]'));
});
