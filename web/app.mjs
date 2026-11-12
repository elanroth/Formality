import {layoutProof,svgDocument,defaultPalette,ruleLabels} from './layout.mjs';
import {declarationNames} from './source.mjs';
import {getConfig,getCatalog,extractProof,getSavedRun} from './service.mjs';
const $=id=>document.getElementById(id);
const canvas=$('tree'),ctx=canvas.getContext('2d');
const state={tree:null,layout:null,selected:null,expanded:new Set(),palette:{...defaultPalette,intro:'#755687',app:'#6d8b9e',constructor:'#6e8f81',recursor:'#b48b61',reference:'#88828f',hypothesis:'#aaa4af',type:'#d4cdd8',projection:'#a57c9e',let:'#6e8f81'},stroke:1.5,camera:{scale:1,x:0,y:0},token:null,catalog:[],busy:false,pointer:null,activeExample:null,manualName:false,selection:0,browser:false,uploadName:null};
const fields=['project','modules','source','declaration','mode','expand-depth','binder','numeral','normalize','max-nodes','max-depth','max-visits','timeout'];
function message(text){$('status').textContent=text;}
function dirty(){
  if(!state.busy){state.selection++;$('loading').hidden=true;}
  $('example-variants').hidden=true;
  if(!state.busy&&state.tree){message('Changes not drawn · Draw proof to update the figure.');$('result-state').classList.add('dirty');$('result-state-text').textContent='Changes not drawn';}
}
const notebookTitles={diagonal:'Cantor’s diagonal argument',induction:'Induction',soundness:'Propositional soundness',godel:'Gödel’s first incompleteness theorem'};
function notebookHeading(declaration){
  const item=state.catalog.find(x=>x.request.declaration===declaration);
  $('page-title').textContent=item?(notebookTitles[item.id]||item.title):(declaration||'Your proof');
}
function sourceChanged(){
  const source=$('source'),names=declarationNames(source.value);
  $('line-numbers').textContent=Array.from({length:source.value.split('\n').length},(_,i)=>i+1).join('\n');
  const lines=source.value?source.value.split('\n').length:0;$('source-lines').textContent=lines+' '+(lines===1?'line':'lines');
  if(!state.manualName&&names.length&&!names.includes($('declaration').value))$('declaration').value=names.at(-1);
  $('detected-label').hidden=state.manualName||!names.includes($('declaration').value);
  const previous=state.catalog.find(x=>x.id===state.activeExample);
  if(previous&&names.length&&!names.includes(previous.request.declaration)&&names.includes($('declaration').value)){
    state.activeExample=null;markExample(null);state.expanded.clear();showExpansions();$('numeral').value='';$('normalize').checked=false;
  }
  $('source-filename').textContent=state.uploadName||state.catalog.find(x=>x.id===state.activeExample)?.file||'proof.lean';
  notebookHeading($('declaration').value);
}
$('source').addEventListener('input',sourceChanged);
$('source').addEventListener('paste',()=>{state.manualName=false;});
$('source').addEventListener('scroll',()=>{$('line-numbers').scrollTop=$('source').scrollTop;});
$('source').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();e.target.setRangeText('  ',e.target.selectionStart,e.target.selectionEnd,'end');sourceChanged();dirty();}});
$('declaration').addEventListener('input',()=>{state.manualName=true;$('detected-label').hidden=true;notebookHeading($('declaration').value);});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();generate();}});
fields.forEach(id=>$(id).addEventListener('input',dirty));
function readRequest(){
  const specialization=$('numeral').value.trim()===''?[]:[[$('binder').value.trim(),Number($('numeral').value)]];
  return{project:$('project').value.trim(),modules:$('modules').value.split(/[,\s]+/).filter(Boolean),source:$('source').value,declaration:$('declaration').value.trim(),mode:$('mode').value,expandDepth:Number($('expand-depth').value),expand:[...state.expanded],specialize:specialization,normalize:$('normalize').checked,maxNodes:Number($('max-nodes').value),maxDepth:Number($('max-depth').value),maxVisits:Number($('max-visits').value),timeoutSeconds:Number($('timeout').value)};
}
function fillRequest(r){
  $('project').value=r.project||'';$('source').value=r.source||'';$('modules').value=(r.modules||[]).join(', ');$('declaration').value=r.declaration||'';
  $('mode').value=r.mode||'raw';$('expand-depth').value=r.expandDepth||0;$('normalize').checked=!!r.normalize;$('max-nodes').value=r.maxNodes||20000;$('max-depth').value=r.maxDepth||300;$('max-visits').value=r.maxVisits||500000;$('timeout').value=r.timeoutSeconds||180;
  $('binder').value=r.specialize?.[0]?.[0]||'n';$('numeral').value=r.specialize?.[0]?.[1]??'';
  state.expanded=new Set(r.expand||[]);state.manualName=false;sourceChanged();showExpansions();
}
function showExpansions(){
  $('selected-count').textContent=state.expanded.size?'('+state.expanded.size+')':'';
  $('selected-lemmas').replaceChildren();
  for(const name of state.expanded){const b=document.createElement('button');b.type='button';b.textContent=name+' ×';b.setAttribute('aria-label','Collapse '+name);b.addEventListener('click',()=>{state.expanded.delete(name);showExpansions();dirty();});$('selected-lemmas').append(b);}
}
function busy(value){
  state.busy=value;
  for(const id of [...fields,'examples','source-file','references','add-reference','clear-expansions'])$(id).disabled=value;
  for(const b of document.querySelectorAll('#selected-lemmas button,#example-cards button,#example-variants button'))b.disabled=value;
  $('generate').disabled=value;$('generate').querySelector('.button-label').textContent=value?'Drawing…':'Draw proof';
  $('loading-text').textContent='Checking & drawing your proof…';$('loading').hidden=!value;
  $('expand-node').disabled=value||!state.tree?.nodes[state.selected]?.expandable;
}
async function generate(){
  if(state.busy)return;
  const request=readRequest();state.selection++;$('error').hidden=true;busy(true);message('Lean is checking the proof and building its tree…');
  try{
    const result=await extractProof(request,text=>{message(text);$('loading-text').textContent=text;});
    showTree(result);
    const run=result.provenance.runId;localStorage.setItem('proof-tree-last-run',run);history.replaceState(null,'','?run='+encodeURIComponent(run));
    message(`${result.nodes.length.toLocaleString()} nodes · kernel checked · ${result.provenance.seconds}s${result.truncated?' · partial tree':''}`);
  }catch(error){$('error').textContent=error.message;$('error').hidden=false;message('Extraction failed. The previous tree is preserved.');}
  finally{busy(false);}
}
function showTree(tree){
  const layout=layoutProof(tree); // Validate imported data before changing the visible result.
  state.tree=tree;state.layout=layout;state.selected=null;
  $('title').textContent=tree.declaration;notebookHeading(tree.declaration);
  $('statement').textContent=tree.displayStatement||tree.statement;
  $('axiom-summary').textContent='Axioms: '+((tree.axioms||[]).join(', ')||'none');
  $('axiom-summary').style.color=(tree.axioms||[]).some(x=>x==='sorryAx')?'#c14443':'';
  $('meta').textContent=`${tree.nodes.length.toLocaleString()} nodes · ${layout.depth} layers · ${tree.mode==='raw'?'full expression':'compact proof'}`;
  $('result-state').hidden=false;$('result-state').classList.remove('dirty');$('result-state-text').textContent=tree.fixture?'Checked example':tree.kernelChecked?'Kernel checked':'Imported tree';
  $('truncation').hidden=!tree.truncated;$('empty').hidden=true;
  for(const id of ['export-svg','export-png','export-json','fit','zoom-out','zoom-in'])$(id).disabled=false;
  const refs=$('references');refs.replaceChildren(new Option('Choose a declaration…',''));
  for(const name of [...(tree.references||[])].sort())refs.append(new Option(name,name));
  const nat=$('nat-binders');nat.replaceChildren();for(const p of tree.parameters||[])if(p.isNat)nat.append(new Option(p.name,p.name));
  const inspect=$('inspect-node');inspect.replaceChildren();
  // Large exports use the clickable canvas or numeric input instead of thousands
  // of long DOM options. Every node remains accessible by its numeric ID.
  const maximum=Math.min(tree.nodes.length,3000);
  for(let i=0;i<maximum;i++){const node=tree.nodes[i];inspect.append(new Option(`${i+1}. ${ruleLabels[node.rule]||node.rule}${node.detail?' · '+node.detail:''}`,i));}
  if(tree.nodes.length>maximum){let input=$('inspect-by-id');if(!input){input=document.createElement('input');input.id='inspect-by-id';input.type='number';input.min='1';input.setAttribute('aria-label','Inspect expression node number');input.addEventListener('change',()=>inspectNode(Number(input.value)-1));inspect.parentElement.append(input);}input.max=tree.nodes.length;input.placeholder='Node number, up to '+tree.nodes.length;}
  else if($('inspect-by-id'))$('inspect-by-id').remove();
  $('record').replaceChildren();
  for(const text of [tree.kernelChecked?'Transformed proof accepted by the Lean kernel.':'Kernel-check status unavailable.',
    'Axioms: '+((tree.axioms||[]).join(', ')||'none'),
    'Specialized parameters: '+((tree.specialized||[]).join(', ')||'none'),
    'Lemma bodies expanded: '+(tree.expansions?.length||0),
    'Limits: '+(tree.truncated?'reached; export is incomplete':'not reached'),
    'Lean: '+(tree.provenance?.leanVersion||'unavailable'),
    'Tree specification: '+(tree.contract?.treeSpecification||'unavailable'),
    'Tree SHA-256: '+(tree.contract?.treeSha256||'unavailable'),
    'Run: '+(tree.provenance?.runId||'imported JSON'),
    'Driver SHA-256: '+(tree.provenance?.driverSha256||'unavailable'),tree.semantics]){const p=document.createElement('p');p.textContent=text;$('record').append(p);}
  legend();fit();
}
function legend(){
  $('legend').replaceChildren();
  const used=new Set(state.layout.marks.map(x=>x.rule));
  for(const rule of Object.keys(ruleLabels)){if(!used.has(rule))continue;const label=document.createElement('label'),input=document.createElement('input');input.type='color';input.value=state.palette[rule];input.setAttribute('aria-label',ruleLabels[rule]+' color');input.addEventListener('input',()=>{state.palette[rule]=input.value;paint();});label.append(input,document.createTextNode(ruleLabels[rule]));$('legend').append(label);}
}
function resize(){
  const dpr=window.devicePixelRatio||1,rect=canvas.getBoundingClientRect();canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);paint();
}
function fit(){
  if(!state.layout)return;
  const {width,height}=canvas.getBoundingClientRect(),l=state.layout;
  state.camera.scale=Math.min((width-35)/l.width,(height-35)/l.height);
  state.camera.x=(width-l.width*state.camera.scale)/2;state.camera.y=(height-l.height*state.camera.scale)/2;paint();
}
function paint(){
  const dpr=window.devicePixelRatio||1;ctx.setTransform(dpr,0,0,dpr,0,0);const w=canvas.width/dpr,h=canvas.height/dpr;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);if(!state.layout)return;
  const camera=state.camera;ctx.translate(camera.x,camera.y);ctx.scale(camera.scale,camera.scale);ctx.lineCap='round';
  // Batch by rule to keep large proof trees responsive while panning.
  for(const rule of Object.keys(ruleLabels)){ctx.strokeStyle=state.palette[rule];ctx.lineWidth=Math.max(state.stroke,.75/camera.scale);ctx.setLineDash(rule==='cutoff'?[4/camera.scale,3/camera.scale]:[]);ctx.beginPath();for(const m of state.layout.marks){if(m.rule!==rule)continue;const sy=camera.y+m.y*camera.scale;if(sy<-10||sy>h+10)continue;ctx.moveTo(m.x1,m.y);ctx.lineTo(m.x2,m.y);}ctx.stroke();}
  ctx.setLineDash([]);
  if(state.selected!==null){const m=state.layout.marks.find(m=>m.id===state.selected);if(m){ctx.strokeStyle='#242a32';ctx.lineWidth=3/camera.scale;ctx.beginPath();ctx.moveTo(m.x1,m.y+4/camera.scale);ctx.lineTo(m.x2,m.y+4/camera.scale);ctx.stroke();}}
  $('zoom-label').textContent=Math.round(camera.scale*100)+'%';
}
function zoom(factor,x,y){
  const c=state.camera;const next=Math.min(30,Math.max(.001,c.scale*factor));const ratio=next/c.scale;c.x=x-(x-c.x)*ratio;c.y=y-(y-c.y)*ratio;c.scale=next;paint();
}
canvas.addEventListener('wheel',e=>{if(!state.layout)return;e.preventDefault();const rect=canvas.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-rect.left,e.clientY-rect.top);},{passive:false});
canvas.addEventListener('pointerdown',e=>{if(!state.layout)return;canvas.setPointerCapture(e.pointerId);state.pointer={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};});
canvas.addEventListener('pointermove',e=>{const p=state.pointer;if(!p)return;const dx=e.clientX-p.x,dy=e.clientY-p.y;if(Math.hypot(e.clientX-p.startX,e.clientY-p.startY)>4)p.moved=true;if(p.moved){state.camera.x+=dx;state.camera.y+=dy;paint();}p.x=e.clientX;p.y=e.clientY;});
canvas.addEventListener('pointerup',e=>{const p=state.pointer;state.pointer=null;if(!p||p.moved||!state.layout)return;const rect=canvas.getBoundingClientRect(),c=state.camera;const x=(e.clientX-rect.left-c.x)/c.scale,y=(e.clientY-rect.top-c.y)/c.scale;let chosen=null,best=Infinity;for(const m of state.layout.marks){const dx=Math.max(m.x1-x,0,x-m.x2),dy=Math.abs(m.y-y);const distance=Math.hypot(dx,dy);if(distance<best&&distance*c.scale<12){chosen=m.id;best=distance;}}if(chosen!==null)inspectNode(chosen);});
canvas.addEventListener('pointercancel',()=>state.pointer=null);
function inspectNode(id){
  const node=state.tree?.nodes[id];if(!node)return;
  state.selected=id;$('inspector').open=true;
  if(!$('inspect-node').querySelector(`option[value="${id}"]`))$('inspect-node').append(new Option(`${id+1}. ${ruleLabels[node.rule]||node.rule}`,id));
  $('inspect-node').value=id;
  $('node-content').textContent=(ruleLabels[node.rule]||node.rule)+(node.detail?' · '+node.detail:'')+'\n\n'+node.term+'\n\n: '+node.type;
  $('expand-node').disabled=!node.expandable||state.busy;paint();
}
$('inspect-node').addEventListener('change',e=>inspectNode(Number(e.target.value)));
$('expand-node').addEventListener('click',()=>{const node=state.tree?.nodes[state.selected];if(node?.expandable){state.expanded.add(node.detail);showExpansions();generate();}});
$('add-reference').addEventListener('click',()=>{const value=$('references').value;if(value){state.expanded.add(value);showExpansions();dirty();}});
$('clear-expansions').addEventListener('click',()=>{state.expanded.clear();$('expand-depth').value='0';showExpansions();if(state.tree)generate();});
$('generate').addEventListener('click',generate);
$('fit').addEventListener('click',fit);
for(const [id,factor]of [['zoom-in',1.5],['zoom-out',1/1.5]])$(id).addEventListener('click',()=>{const r=canvas.getBoundingClientRect();zoom(factor,r.width/2,r.height/2);});
$('line-weight').addEventListener('input',e=>{state.stroke=Number(e.target.value);paint();});
new ResizeObserver(()=>{resize();if(state.layout)fit();}).observe($('canvas-wrap'));

function download(blob,suffix){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(state.tree?.declaration||'proof-tree').replace(/[^\w.-]/g,'_')+'.'+suffix;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportSVG(){return svgDocument(state.tree,state.layout,{palette:state.palette,stroke:state.stroke});}
$('export-svg').addEventListener('click',()=>download(new Blob([exportSVG()],{type:'image/svg+xml'}),'svg'));
$('export-json').addEventListener('click',()=>download(new Blob([JSON.stringify({...state.tree,appearance:{palette:state.palette,stroke:state.stroke}})],{type:'application/json'}),'json'));
$('export-png').addEventListener('click',async()=>{
  const url=URL.createObjectURL(new Blob([exportSVG()],{type:'image/svg+xml'}));
  try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(2,6000/img.width,6000/img.height),out=document.createElement('canvas');out.width=Math.min(6000,Math.ceil(img.width*scale));out.height=Math.min(6000,Math.ceil(img.height*scale));out.getContext('2d').drawImage(img,0,0,out.width,out.height);const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG generation failed.');download(blob,'png');message(`PNG exported at ${out.width} × ${out.height}px. SVG retains full vector detail.`);}catch(error){message(error.message);}finally{URL.revokeObjectURL(url);}
});
$('source-file').addEventListener('change',async e=>{const file=e.target.files[0];if(file){$('source').value=await file.text();state.uploadName=file.name;state.manualName=false;sourceChanged();dirty();}e.target.value='';});
$('json-file').addEventListener('change',async e=>{
  try{const file=e.target.files[0];if(!file)return;const data=JSON.parse(await file.text());showTree(data);if(data.request)fillRequest(data.request);if(data.appearance){Object.assign(state.palette,data.appearance.palette||{});state.stroke=data.appearance.stroke||1.5;legend();paint();}message('Loaded saved tree. Generate to recheck or change its expansion.');}catch(error){message('Could not load JSON: '+error.message);}finally{e.target.value='';}
});
function markExample(id){
  for(const button of $('example-cards').children)button.setAttribute('aria-pressed',String(button.dataset.id===id));
}
function renderCards(){
  const labels={diagonal:'Cantor',induction:'Induction',soundness:'Soundness',godel:'Gödel I'};
  for(const item of state.catalog.filter(x=>x.featured).sort((a,b)=>(a.order||0)-(b.order||0))){
    const b=document.createElement('button');b.type='button';b.className='example-card';b.dataset.id=item.id;b.setAttribute('aria-pressed','false');
    b.textContent=labels[item.id]||item.shortTitle||item.title;
    b.addEventListener('click',()=>selectExample(item));$('example-cards').append(b);
  }
}
async function loadPreset(item,depth=0){
  const preset=item.variants?.[depth]||item.preset;if(!preset)return;
  const selection=++state.selection;$('loading-text').textContent='Opening a checked proof…';$('loading').hidden=false;
  try{
    const response=await fetch(new URL('examples/'+preset,import.meta.url));if(!response.ok)throw Error('Example could not be loaded.');
    const tree=await response.json();if(selection!==state.selection)return;
    fillRequest({...item.request,...tree.request,project:item.request.project||'',expandDepth:item.variants?depth:tree.request.expandDepth||0});
    showTree(tree);$('example-variants').hidden=!item.variants;
    for(const b of $('example-variants').querySelectorAll('button'))b.setAttribute('aria-pressed',String(Number(b.dataset.depth)===depth));
    message(state.browser&&item.id==='godel'?'Saved Foundation proof · explore its lemma layers or download the image. Use the CLI to regenerate this example.':item.available===false?'Saved, kernel-checked example · choose a project in Options to regenerate.':'Checked example loaded · edit the proof or save its figure.');
    localStorage.removeItem('proof-tree-last-run');history.replaceState(null,'','?example='+item.id+(depth?'&depth='+depth:''));
  }catch(error){if(selection===state.selection)message(error.message);}
  finally{if(selection===state.selection)$('loading').hidden=true;}
}
async function selectExample(item,depth=0){
  if(state.busy)return;state.uploadName=null;state.activeExample=item.id;markExample(item.id);$('examples').value=item.id;
  fillRequest(item.request);$('example-note').textContent=item.description||'';$('error').hidden=true;
  if(item.id==='induction'){$('options').open=true;$('unfold-options').open=true;}
  if(item.preset)await loadPreset(item,depth);else{$('example-variants').hidden=true;dirty();message('Example loaded · Draw proof to check it with Lean.');}
}
$('examples').addEventListener('change',e=>{const item=state.catalog.find(x=>x.id===e.target.value);if(item)selectExample(item);});
for(const b of $('example-variants').querySelectorAll('button'))b.addEventListener('click',()=>{const item=state.catalog.find(x=>x.id===state.activeExample);if(item&&!state.busy)loadPreset(item,Number(b.dataset.depth));});

async function init(){
  const [config,catalog]=await Promise.all([getConfig(),getCatalog()]);
  state.token=config.token;state.catalog=catalog;state.browser=config.mode==='browser';$('project-options').hidden=state.browser;$('engine-badge').lastChild.textContent=state.browser?'Lean '+(config.leanVersion||'4')+' · browser':'Lean '+config.toolchain.split(':v').at(-1);
  for(const item of catalog){const option=new Option(item.title,item.id);option.disabled=item.available===false&&!item.preset;$('examples').append(option);}
  renderCards();
  const params=new URLSearchParams(location.search),named=catalog.find(x=>x.id===params.get('example'));
  if(named){await selectExample(named,Math.max(0,Math.min(2,Number(params.get('depth'))||0)));return;}
  const run=params.get('run')||localStorage.getItem('proof-tree-last-run');
  if(run){const tree=await getSavedRun(run);if(tree){if(tree.request)fillRequest(tree.request);showTree(tree);const item=catalog.find(i=>i.request.declaration===tree.declaration);if(item){state.activeExample=item.id;markExample(item.id);$('examples').value=item.id;$('example-note').textContent=item.description;}message('Loaded checked proof · edit settings or save its image.');return;}}
  await selectExample(catalog.find(x=>x.id==='diagonal'));

}
window.formalityBeforeReload=()=>{if($('result-state').classList.contains('dirty'))sessionStorage.setItem('formality-coi-draft',JSON.stringify(readRequest()));};
function restoreDraft(){const draft=sessionStorage.getItem('formality-coi-draft');if(draft){sessionStorage.removeItem('formality-coi-draft');try{state.activeExample=null;markExample(null);fillRequest(JSON.parse(draft));dirty();message('Your proof was kept while the browser compiler was prepared. Draw proof to continue.');}catch{}}}
$('about-link').addEventListener('click',()=>{$('about').open=true;});
init().then(restoreDraft).catch(error=>message('Could not connect to the Lean service: '+error.message));
