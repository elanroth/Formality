// Browser-only execution. It uses the same Lean expression exporter as the CLI.
// The browser contract records a pinned WASM build, not a native compiler lock.
let compilerPromise,sdkPromise;
export function makeBrowserDriver(source,modules,cfg,exporter){
  // Call the MetaM API directly: browser provenance comes from the pinned asset
  // manifest, so native path discovery and the file-output command are omitted.
  const boundary=exporter.indexOf('elab "#proof_tree "');
  if(boundary<0)throw Error('Unsupported proof exporter.');
  const core=exporter.slice(0,boundary)
    .replace('namespace ProofTreeTool','namespace ProofTreeTool\nmeta section')
    .replace('  deriving FromJson','')
    .replace(/def shortPP \(e : Expr\) : MetaM String :=[^]*?\npartial def specializeExpr/,'def shortPP (e : Expr) : MetaM String := do\n  return (← ppExpr e).pretty\n\npartial def specializeExpr')

    .replace(/  let imports ←[^]*?\n  let identity := \[/,'  let imports := (#[] : Array Json)\n  let identity := [')+'\nend\nend ProofTreeTool\n';
  const str=JSON.stringify,array=xs=>'#['+xs.map(str).join(',')+']';
  const record=`{ declaration := ${str(cfg.declaration)}, output := "", mode := ${str(cfg.mode)}, expand := ${array(cfg.expand)}, expandDepth := ${cfg.expandDepth}, maxNodes := ${cfg.maxNodes}, maxDepth := ${cfg.maxDepth}, maxVisits := ${cfg.maxVisits}, normalize := ${cfg.normalize}, specialize := #[${cfg.specialize.map(([n,k])=>'('+str(n)+','+k+')').join(',')}] }`;
  return 'module\nimport Lean\npublic meta import Lean.Meta.Reduce\n'+modules.map(m=>'import '+m+'\n').join('')+source+'\n\nset_option pp.maxSteps 1500\nset_option maxRecDepth 1024\nset_option maxHeartbeats 40000000\n'+core+`
#eval IO.println ("FORMALITY_VERSION=" ++ Lean.versionString)
open Lean Elab in
run_elab do
  let cfg : ProofTreeTool.Config := ${record}
  let result ← ProofTreeTool.exportDeclaration cfg
  logInfo m!"FORMALITY_TREE={result.compress}"
`;
}
const encoder=new TextEncoder();
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const canonical=v=>JSON.stringify(ordered(v));
const sha=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(v)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const integer=(v,fallback,min,max,label)=>{v??=fallback;if(!Number.isInteger(v)||v<min||v>max)throw Error(`${label} must be an integer between ${min} and ${max}.`);return v;};
function sdk(){return sdkPromise??=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('vendor/lean-wasm.global.js',import.meta.url);s.onload=()=>resolve(globalThis.leanWasm);s.onerror=()=>reject(Error('Could not load the browser Lean runtime.'));document.head.append(s);});}
async function compiler(config,progress){
  if(!globalThis.crossOriginIsolated)throw Error('Browser proof checking needs the isolated page. Reload this page once; if it persists, open it in a current Chrome, Firefox, or Safari browser.');
  return compilerPromise??=(async()=>{progress('Preparing Lean in your browser…');const api=await sdk();return api.createCompiler({baseUrl:new URL(config.assetBase,import.meta.url).href,syntaxCheck:'full',onProgress:()=>progress('Preparing Lean and its libraries for the first run…'),onStatus:()=>{}});})().catch(error=>{compilerPromise=null;throw error;});
}
async function saveLatest(tree){return new Promise(resolve=>{try{const r=indexedDB.open('formality-browser',1);r.onupgradeneeded=()=>r.result.createObjectStore('proofs');r.onerror=()=>resolve();r.onsuccess=()=>{const db=r.result;const tx=db.transaction('proofs','readwrite');tx.objectStore('proofs').put(tree,'latest');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();resolve();};};}catch{resolve();}});}
export async function extractInBrowser(request,config,onProgress=()=>{}){
  const source=String(request.source||''),declaration=String(request.declaration||'').trim();
  if(!declaration||/\s/.test(declaration)||declaration.length>400)throw Error('Enter the named theorem to draw.');
  if(encoder.encode(source).length>512000)throw Error('This proof is too large to paste. Use the CLI to import its project.');
  if(request.project)throw Error('The browser uses its bundled libraries. Local project folders are available in the Formality CLI.');
  if(/(?:^|\n)\s*(?:public\s+)?import\s+Foundation\b/.test(source)||(request.modules||[]).some(m=>m.startsWith('Foundation')))
    throw Error('Foundation is available here as a saved, kernel-checked example. Explore its lemma layers and download the image, or use the Formality CLI to regenerate it. Pasted standalone Lean proofs run in this browser.');
  const modules=request.modules||[];
  if(!Array.isArray(modules)||!modules.every(x=>typeof x==='string'&&/^[\p{L}\p{N}_'.]+$/u.test(x)))throw Error('Enter valid Lean import module names.');
  const mode=request.mode||'compact';if(!['raw','compact'].includes(mode))throw Error('Choose compact or full expression mode.');
  const cfg={declaration,output:'/workspace/formality.json',mode,expand:request.expand||[],
    expandDepth:integer(request.expandDepth,0,0,8,'Lemma depth'),maxNodes:integer(request.maxNodes,20000,100,100000,'Node budget'),
    maxDepth:integer(request.maxDepth,300,10,500,'Depth budget'),maxVisits:integer(request.maxVisits,500000,100,50000000,'Transformation budget'),
    normalize:request.normalize===true,specialize:request.specialize||[]};
  const timeout=integer(request.timeoutSeconds,180,1,1800,'Time limit')*1000;
  if(!Array.isArray(cfg.expand)||cfg.expand.length>100||!cfg.expand.every(s=>typeof s==='string'))throw Error('Choose valid lemma names.');
  if(!Array.isArray(cfg.specialize)||cfg.specialize.length>20||!cfg.specialize.every(p=>Array.isArray(p)&&p.length===2&&typeof p[0]==='string'&&Number.isInteger(p[1])&&p[1]>=0&&p[1]<=10000))throw Error('Specialization needs a parameter name and natural number.');
  let timer,canceled=false;
  const started=performance.now();
  try{
    return await Promise.race([(async()=>{
      const lean=await compiler(config,onProgress);
      if(canceled)throw Error("Proof generation was canceled.");
      const exporter=await fetch(new URL('Exporter.lean',import.meta.url)).then(r=>{if(!r.ok)throw Error('Could not load the proof exporter.');return r.text();});
      const driver=makeBrowserDriver(source,modules,cfg,exporter);
      onProgress('Lean is checking your proof. The first run also loads its libraries…');
      const result=await lean.run(driver);
      if(canceled)throw Error('Proof generation was canceled.');
      if(result.runtimeError){lean.dispose();compilerPromise=null;}
      if(result.exitCode!==0)throw Error(result.errors.join('\n')||result.runtimeError||'Lean could not check this proof.');
      const line=result.output.split('\n').findLast(s=>s.startsWith('FORMALITY_TREE='));
      if(!line)throw Error(result.errors.join('\n')||'Lean returned no proof tree. Check the theorem name and source.');
      const tree=JSON.parse(line.slice('FORMALITY_TREE='.length));
      const version=result.output.split('\n').find(s=>s.startsWith('FORMALITY_VERSION='))?.slice('FORMALITY_VERSION='.length)||config.leanCommit;
      // Bound previews after printing: this WASM interpreter cannot execute the
      // native printer's local-options wrapper reliably.
      const preview=s=>[...s].slice(0,2200).join('');
      for(const node of tree.nodes){node.term=preview(node.term);node.type=preview(node.type);}
      tree.statement=preview(tree.statement);tree.displayStatement=preview(tree.displayStatement);
      for(const param of tree.parameters)param.type=preview(param.type);
      delete tree.importedModules;
      tree.request={...request,project:''};tree.provenance={leanVersion:version,sourceKind:'browser WebAssembly',sourceSha256:await sha(source),driverSha256:await sha(driver),runId:'browser-'+Date.now().toString(36),seconds:Math.round((performance.now()-started)/10)/100};
      const keys=['schema','declaration','statement','displayStatement','parameters','root','nodes','axioms','references','expansions','specialized','truncated','mode','semantics'];
      tree.contract={schema:'lean-proof-tree/browser-contract/v1',tool:{version:config.toolVersion,exporterSha256:await sha(exporter)},
        treeSpecification:'lean-expr/browser-'+mode+'/v1',input:{declaration,modules,sourceSha256:tree.provenance.sourceSha256},
        options:cfg,environment:{kind:'browser-wasm',leanCommit:config.leanCommit,reportedVersion:version,runtimeCommit:config.runtimeCommit,assetManifestSha256:config.assetManifestSha256},
        treeSha256:await sha(canonical(Object.fromEntries(keys.map(k=>[k,tree[k]]))))};
      tree.diagnostics=result.errors.join('\n');await saveLatest(tree);return tree;
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{canceled=true;compilerPromise?.then(c=>c.dispose()).catch(()=>{});compilerPromise=null;reject(Error('The browser time limit was reached. Reduce the lemma expansion or raise the limit in Options.'));},timeout);})]);
  }catch(error){if(!compilerPromise) sdkPromise=null;throw error;}finally{clearTimeout(timer);}
}
