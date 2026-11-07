// Materialize a static /formality application. Compiler assets stay out of this repo.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const output=path.resolve(arg('--output',path.join(root,'dist/pages/formality')));
const runtime=path.resolve(arg('--runtime',path.join(root,'../formality-deps/browser-lean')));
const pinned='a8aed095534e67061e2626b94e8e69193099091d';
const external=args.includes('--external-runtime');
const actual=execFileSync('git',['rev-parse','HEAD'],{cwd:runtime,encoding:'utf8'}).trim();
if(actual!==pinned)throw Error('Browser runtime must be pinned to '+pinned);
await fs.mkdir(output,{recursive:true});
await fs.cp(path.join(root,'web'),output,{recursive:true});
await fs.copyFile(path.join(root,'lean/Exporter.lean'),path.join(output,'Exporter.lean'));
await fs.copyFile(path.join(root,'web/vendor/coi-serviceworker.js'),path.join(output,'coi-serviceworker.js'));
const assetBase=path.join(output,'lean-runtime');await fs.mkdir(assetBase,{recursive:true});
if(!external)for(const folder of ['lean-wasm','lean-lib','lean-mathlib'])await fs.cp(path.join(runtime,'public',folder),path.join(assetBase,folder),{recursive:true});
const hashes={};
async function scan(folder,prefix=''){for(const e of (await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){const name=prefix+e.name,p=path.join(folder,e.name);if(e.isDirectory())await scan(p,name+'/');else{const b=await fs.readFile(p);hashes[name]={sha256:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length};}}}
for(const folder of ['lean-wasm','lean-lib','lean-mathlib'])await scan(path.join(runtime,'public',folder),folder+'/');
const manifest={runtimeRepository:'https://github.com/live-codes/browser-lean',runtimeCommit:pinned,leanCommit:'62b6a2291302d4bbeace37642a066b7510d0145c',files:hashes};
const manifestBytes=JSON.stringify(manifest)+'\n';await fs.writeFile(path.join(assetBase,'manifest.json'),manifestBytes);
await fs.copyFile(path.join(root,'web/examples/FOUNDATION-LICENSE.txt'),path.join(assetBase,'APACHE-2.0.txt'));
const config={mode:'browser',toolVersion:'0.5.0',assetBase:external?`https://raw.githubusercontent.com/live-codes/browser-lean/${pinned}/public/`:'./lean-runtime/',runtimeCommit:pinned,leanCommit:manifest.leanCommit,assetManifestSha256:crypto.createHash('sha256').update(manifestBytes).digest('hex')};
await fs.writeFile(path.join(output,'runtime-config.json'),JSON.stringify(config,null,2)+'\n');
const catalog=JSON.parse(await fs.readFile(path.join(root,'examples/catalog.json'),'utf8'));
for(const item of catalog){if(item.file)item.request.source=await fs.readFile(path.join(root,'examples',item.file),'utf8');item.request.project='';if(item.foundationProject)item.available=false;delete item.foundationProject;delete item.mathlibProject;}
await fs.writeFile(path.join(output,'catalog.json'),JSON.stringify(catalog));
let html=await fs.readFile(path.join(output,'index.html'),'utf8');
html=html.replace('<head>','<head>\n  <meta name="formality-runtime" content="browser">\n  <script>window.coi={quiet:true,doReload:()=>{window.formalityBeforeReload?.();location.reload();}};</script>\n  <script src="./coi-serviceworker.js"></script>');
html=html.replaceAll('href="/"','href="./"').replaceAll('href="/style.css"','href="./style.css"').replaceAll('src="/app.mjs"','src="./app.mjs"');
html=html.replace('Your code is checked by Lean before its tree is generated.','Lean runs in this browser. Your code is not uploaded.');
await fs.writeFile(path.join(output,'index.html'),html);
await fs.writeFile(path.join(output,'.nojekyll'),'');
console.log(JSON.stringify({output,files:Object.keys(hashes).length,assetBytes:Object.values(hashes).reduce((n,x)=>n+x.bytes,0),runtimeCommit:pinned,externalRuntime:external}));
