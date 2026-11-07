let configPromise;
const here=path=>new URL(path,import.meta.url);
async function readJson(path){const r=await fetch(here(path));if(!r.ok)throw Error(`Could not load ${path}.`);return r.json();}
export function getConfig(){
  return configPromise??=(async()=>document.querySelector('meta[name="formality-runtime"]')?.content==='browser'
    ?readJson('runtime-config.json'):{...await readJson('api/config'),mode:'native'})();
}
export async function getCatalog(){const config=await getConfig();return readJson(config.mode==='browser'?'catalog.json':'api/examples');}
export async function extractProof(request,onProgress){
  const config=await getConfig();
  if(config.mode==='browser'){const {extractInBrowser}=await import('./browser-engine.mjs');return extractInBrowser(request,config,onProgress);}
  const response=await fetch(here('api/extract'),{method:'POST',headers:{'Content-Type':'application/json','X-ProofTree-Token':config.token},body:JSON.stringify(request)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Extraction failed.');return result;
}
export async function getSavedRun(id){
  const config=await getConfig();if(config.mode!=='browser'){const r=await fetch(here('api/result/'+encodeURIComponent(id)));return r.ok?r.json():null;}
  return new Promise(resolve=>{try{const r=indexedDB.open('formality-browser',1);r.onupgradeneeded=()=>r.result.createObjectStore('proofs');r.onerror=()=>resolve(null);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('proofs','readonly').objectStore('proofs').get('latest');tx.onsuccess=()=>{db.close();resolve(tx.result?.provenance?.runId===id?tx.result:null);};tx.onerror=()=>{db.close();resolve(null);};};}catch{resolve(null);}});
}
