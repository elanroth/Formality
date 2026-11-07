import test from 'node:test';
import assert from 'node:assert/strict';
import {declarationNames} from '../web/source.mjs';

test('suggests the names of theorem and lemma declarations',()=>{
  assert.deepEqual(declarationNames('theorem first : True := True.intro\nlemma second : True := first'),['first','second']);
});
test('tracks nested namespaces and named section endings',()=>{
  assert.deepEqual(declarationNames('namespace A\nsection Vars\nnamespace B\ntheorem t : True := True.intro\nend B\nend Vars\nlemma u : True := True.intro\nend A\ntheorem v : True := True.intro'),['A.B.t','A.u','v']);
});
test('ignores nested comments, line comments, and quoted strings',()=>{
  assert.deepEqual(declarationNames('/- theorem fake /- namespace Bad -/ -/\n-- theorem wrong\n#eval "theorem alsoWrong"\ntheorem actual : True := True.intro'),['actual']);
});
test('supports attributes, visibility prefixes, and Unicode identifiers',()=>{
  assert.deepEqual(declarationNames('@[simp] public theorem αβ : True := True.intro\nprivate lemma γ : True := αβ'),['αβ','γ']);
});
test('does not invent names for imported or anonymous proofs',()=>{
  assert.deepEqual(declarationNames('import Foundation.FirstOrder.Incompleteness.First\nexample : True := True.intro'),[]);
});
test('keeps an explicitly rooted declaration outside its current namespace',()=>{
  assert.deepEqual(declarationNames('namespace A\ntheorem _root_.outside : True := True.intro\nend A'),['outside']);
});
