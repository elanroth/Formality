export const defaultPalette={intro:'#8055b6',app:'#2874c3',constructor:'#19856d',recursor:'#d57b21',lemma:'#627080',reference:'#627080',hypothesis:'#627080',type:'#adb5bf',projection:'#b9517d',let:'#19856d',axiom:'#c14443',cutoff:'#c14443'};
export const ruleLabels={intro:'Π introduction',app:'Application',constructor:'Constructor',recursor:'Recursor',lemma:'Lemma reference',reference:'Definition / constant',hypothesis:'Hypothesis',type:'Type / data',projection:'Projection',let:'Let binding',axiom:'Axiom',cutoff:'Omitted subtree'};

export function layoutProof(data,{width,height,taper=.88}={}){
  if(!Number.isFinite(taper)||taper<0||taper>=1)throw Error('Taper must be in [0,1).');
  for(const size of [width,height])if(size!==undefined&&(!Number.isFinite(size)||size<100||size>100000))throw Error('Figure dimensions must be between 100 and 100000.');
  if(data.schema!=='proof-tree/v1'||!Array.isArray(data.nodes)||data.nodes.length>200000)throw Error('Unsupported proof-tree JSON.');
  const active=new Set();let visits=0;
  function build(id,depth=0){
    if(!Number.isInteger(id)||id<0||id>=data.nodes.length)throw Error('Invalid child reference.');
    if(active.has(id)||depth>1000||++visits>400000)throw Error('Cyclic or oversized graph.');
    active.add(id);const node=data.nodes[id];
    if(!Array.isArray(node.children))throw Error('Missing children.');
    const kids=node.children.map(x=>build(x,depth+1));active.delete(id);
    return{id,node,kids,leaves:kids.length?kids.reduce((s,c)=>s+c.leaves,0):1,height:kids.length?1+Math.max(...kids.map(c=>c.height)):0};
  }
  const root=build(data.root);
  width??=Math.min(20000,Math.max(1600,root.leaves*8));
  height??=Math.min(16000,Math.max(650,width*.68,root.height*15));
  const margin=30,marks=[];
  function place(n,left,right){
    const progress=root.height?n.height/root.height:1;
    const scale=1-taper*progress;
    const inset=Math.min(8,(right-left)*.12);
    const x1=width/2+(left+inset-width/2)*scale;
    const x2=Math.max(x1+.3,width/2+(right-inset-width/2)*scale);
    const y=margin+progress*(height-2*margin);
    marks.push({id:n.id,rule:n.node.rule,x1,x2,y});
    let x=left;
    for(const c of n.kids){const w=(right-left)*c.leaves/n.leaves;place(c,x,x+w);x+=w;}
  }
  place(root,margin,width-margin);
  return{width,height,marks,depth:root.height,leaves:root.leaves};
}

function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function ordered(value){if(Array.isArray(value))return value.map(ordered);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])]));return value;}
function wrap(s,length){const lines=[];for(const line of String(s).split('\n')){let rest=line;while(rest.length>length){let at=rest.lastIndexOf(' ',length);if(at<length/3)at=length;lines.push(rest.slice(0,at));rest=rest.slice(at).trimStart();}lines.push(rest);}return lines;}

export function svgDocument(data,layout,settings={}){
  const palette={...defaultPalette,...settings.palette};
  for(const color of Object.values(palette))if(!/^#[0-9a-f]{6}$/i.test(color))throw Error('Invalid palette color.');
  const stroke=Number(settings.stroke??1.5);
  if(!Number.isFinite(stroke)||stroke<=0||stroke>20)throw Error('Invalid stroke width.');
  // Figure units scale with the poster width. Otherwise a large proof's labels
  // and strokes become subpixel-thin when the SVG is printed or rasterized.
  const unit=Math.max(1,layout.width/1600);
  const lines=wrap(data.displayStatement||data.statement,Math.max(50,Math.floor(layout.width/(12*unit))));
  const head=(80+lines.length*25)*unit,foot=125*unit;
  const rules=[...new Set(layout.marks.map(x=>x.rule))];
  const title=escape(data.declaration);
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height+head+foot}" viewBox="0 0 ${layout.width} ${layout.height+head+foot}" role="img" aria-label="${title} proof-term tree">`,
    `<title>${title}</title><desc>${escape(data.semantics)} ${data.truncated?'TRUNCATED: omitted subtrees are marked.':''}</desc>`,
    `<metadata>${escape(JSON.stringify(ordered(data.contract?{contract:data.contract,drawing:settings,axioms:data.axioms,truncated:data.truncated,semantics:data.semantics}:{declaration:data.declaration,provenance:data.provenance,config:data.config,axioms:data.axioms,truncated:data.truncated,semantics:data.semantics})))}</metadata>`,
    '<rect width="100%" height="100%" fill="white"/>',
    `<text x="${30*unit}" y="${35*unit}" font-family="system-ui,sans-serif" font-size="${22*unit}" fill="#242a32">${title}</text>`];
  lines.forEach((line,i)=>parts.push(`<text x="${30*unit}" y="${(70+i*25)*unit}" font-family="ui-monospace,monospace" font-size="${18*unit}" fill="#525d6b">${escape(line)}</text>`));
  parts.push(`<g transform="translate(0 ${head})" fill="none" stroke-linecap="round" stroke-width="${stroke*unit}">`);
  for(const m of layout.marks){const color=palette[m.rule]||palette.reference;parts.push(`<path d="M${m.x1.toFixed(2)} ${(m.y).toFixed(2)}H${m.x2.toFixed(2)}" stroke="${color}"${m.rule==='cutoff'?' stroke-dasharray="4 3"':''}><title>${escape(ruleLabels[m.rule]||m.rule)} · ${escape(data.nodes[m.id].detail)}</title></path>`);}
  parts.push('</g>');
  const baseline=head+layout.height+30*unit;
  let x=30*unit;
  rules.forEach((rule,i)=>{if(i%6===0)x=30*unit;const row=Math.floor(i/6);parts.push(`<path d="M${x} ${baseline+row*30*unit}h${18*unit}" stroke="${palette[rule]||palette.reference}" stroke-width="${2*unit}"/><text x="${x+25*unit}" y="${baseline+(row*30+5)*unit}" font-family="system-ui,sans-serif" font-size="${15*unit}" fill="#525d6b">${escape(ruleLabels[rule]||rule)}</text>`);x+=layout.width/6;});
  parts.push(`<text x="${30*unit}" y="${head+layout.height+foot-12*unit}" font-family="system-ui,sans-serif" font-size="${14*unit}" fill="${data.truncated?'#c14443':'#68717d'}">${escape(`${data.mode} expression tree · ${data.nodes.length} nodes · ${data.truncated?'TRUNCATED · ':''}${data.provenance?.leanVersion||'Lean'} · typing/conversion derivations omitted`)}</text></svg>`);
  return parts.join('\n');
}
