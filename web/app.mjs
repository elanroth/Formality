import {layoutProof,svgDocument,defaultPalette,ruleLabels} from './layout.mjs';
const $=id=>document.getElementById(id);
const canvas=$('tree'),ctx=canvas.getContext('2d');
const state={tree:null,layout:null,selected:null,expanded:new Set(),palette:{...defaultPalette},stroke:1.5,camera:{scale:1,x:0,y:0},token:null,catalog:[],busy:false,pointer:null};
const fields=['project','modules','source','declaration','mode','expand-depth','binder','numeral','normalize','max-nodes','max-depth'];
function message(text){$('status').textContent=text;}
function dirty(){if(!state.busy&&state.tree)message('Settings changed · Generate tree to apply.');}
fields.forEach(id=>$(id).addEventListener('input',dirty));
function readRequest(){
  const specialization=$('numeral').value.trim()===''?[]:[[$('binder').value.trim(),Number($('numeral').value)]];
  return{project:$('project').value.trim(),modules:$('modules').value.split(/[,\s]+/).filter(Boolean),source:$('source').value,declaration:$('declaration').value.trim(),mode:$('mode').value,expandDepth:Number($('expand-depth').value),expand:[...state.expanded],specialize:specialization,normalize:$('normalize').checked,maxNodes:Number($('max-nodes').value),maxDepth:Number($('max-depth').value)};
}
function fillRequest(r){
  $('project').value=r.project||'';$('source').value=r.source||'';$('modules').value=(r.modules||[]).join(', ');$('declaration').value=r.declaration||'';
  $('mode').value=r.mode||'raw';$('expand-depth').value=r.expandDepth||0;$('normalize').checked=!!r.normalize;$('max-nodes').value=r.maxNodes||20000;$('max-depth').value=r.maxDepth||300;
  $('binder').value=r.specialize?.[0]?.[0]||'n';$('numeral').value=r.specialize?.[0]?.[1]??'';
  state.expanded=new Set(r.expand||[]);showExpansions();
}
function showExpansions(){
  $('selected-count').textContent=state.expanded.size?'('+state.expanded.size+')':'';
  $('selected-lemmas').replaceChildren();
  for(const name of state.expanded){const b=document.createElement('button');b.type='button';b.textContent=name+' ×';b.setAttribute('aria-label','Collapse '+name);b.addEventListener('click',()=>{state.expanded.delete(name);showExpansions();dirty();});$('selected-lemmas').append(b);}
}
function busy(value){state.busy=value;for(const id of [...fields,'examples','source-file','references','add-reference','clear-expansions'])$(id).disabled=value;for(const button of $('selected-lemmas').querySelectorAll('button'))button.disabled=value;$('generate').disabled=value;$('generate').textContent=value?'Checking & extracting…':'Generate tree';$('expand-node').disabled=value||!state.tree?.nodes[state.selected]?.expandable;}
async function generate(){
  if(state.busy)return;
  const request=readRequest();$('error').hidden=true;busy(true);message('Lean is checking the proof and building its tree…');
  try{
    const response=await fetch('/api/extract',{method:'POST',headers:{'Content-Type':'application/json','X-ProofTree-Token':state.token},body:JSON.stringify(request)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Extraction failed.');
    showTree(result);
    const run=result.provenance.runId;localStorage.setItem('proof-tree-last-run',run);history.replaceState(null,'','?run='+encodeURIComponent(run));
    message(`${result.nodes.length.toLocaleString()} nodes · kernel checked · ${result.provenance.seconds}s${result.truncated?' · partial tree':''}`);
  }catch(error){$('error').textContent=error.message;$('error').hidden=false;message('Extraction failed. The previous tree is preserved.');}
  finally{busy(false);}
}
function showTree(tree){
  const layout=layoutProof(tree); // Validate imported data before changing the visible result.
  state.tree=tree;state.layout=layout;state.selected=null;
  $('title').textContent=tree.declaration;
  $('statement').textContent=tree.displayStatement||tree.statement;
  $('axiom-summary').textContent='Axioms: '+((tree.axioms||[]).join(', ')||'none');
  $('axiom-summary').style.color=(tree.axioms||[]).some(x=>x==='sorryAx')?'#c14443':'';
  $('meta').textContent=`${tree.nodes.length.toLocaleString()} expression nodes · depth ${layout.depth} · ${tree.mode==='raw'?'full expression':'compact proof'} · ${tree.provenance?.leanVersion||'imported export'}`;
  $('truncation').hidden=!tree.truncated;$('empty').hidden=true;
  for(const id of ['export-svg','export-png','export-json','fit','zoom-out','zoom-in'])$(id).disabled=false;
  const refs=$('references');refs.replaceChildren(new Option('Choose a declaration…',''));
  for(const name of (tree.references||[]).sort())refs.append(new Option(name,name));
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
  try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(2,6000/img.width,6000/img.height),out=document.createElement('canvas');out.width=Math.ceil(img.width*scale);out.height=Math.ceil(img.height*scale);out.getContext('2d').drawImage(img,0,0,out.width,out.height);const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG generation failed.');download(blob,'png');message(`PNG exported at ${out.width} × ${out.height}px. SVG retains full vector detail.`);}catch(error){message(error.message);}finally{URL.revokeObjectURL(url);}
});
$('source-file').addEventListener('change',async e=>{const file=e.target.files[0];if(file){$('source').value=await file.text();dirty();}e.target.value='';});
$('json-file').addEventListener('change',async e=>{
  try{const file=e.target.files[0];if(!file)return;const data=JSON.parse(await file.text());showTree(data);if(data.request)fillRequest(data.request);if(data.appearance){Object.assign(state.palette,data.appearance.palette||{});state.stroke=data.appearance.stroke||1.5;legend();paint();}message('Loaded saved tree. Generate to recheck or change its expansion.');}catch(error){message('Could not load JSON: '+error.message);}finally{e.target.value='';}
});
$('examples').addEventListener('change',e=>{
  const item=state.catalog.find(x=>x.id===e.target.value);if(!item)return;
  fillRequest(item.request);$('example-note').textContent=item.description;
  message('Example loaded · Generate tree to check and extract it.');
});

async function init(){
  const [config,catalog]=await Promise.all([fetch('/api/config').then(r=>r.json()),fetch('/api/examples').then(r=>r.json())]);
  state.token=config.token;state.catalog=catalog;
  for(const item of catalog){const option=new Option(item.title,item.id);option.disabled=item.available===false;$('examples').append(option);}
  const run=new URLSearchParams(location.search).get('run')||localStorage.getItem('proof-tree-last-run');
  if(run){const response=await fetch('/api/result/'+encodeURIComponent(run));if(response.ok){const tree=await response.json();if(tree.request)fillRequest(tree.request);showTree(tree);const item=catalog.find(i=>i.request.declaration===tree.declaration);if(item){$('examples').value=item.id;$('example-note').textContent=item.description;}message('Loaded checked proof · edit settings and generate to explore.');return;}}
  $('examples').value='diagonal';$('examples').dispatchEvent(new Event('change'));
}
init().catch(error=>message('Could not connect to the local service: '+error.message));
