// Name suggestions for the editor only. Lean remains the proof parser/checker.
export function declarationNames(source){
  let clean='',block=0,string=false,line=false,escaped=false;
  for(let i=0;i<source.length;i++){
    const c=source[i],next=source[i+1];
    if(line){if(c==='\n'){line=false;clean+='\n';}else clean+=' ';continue;}
    if(block){if(c==='/'&&next==='-'){block++;clean+='  ';i++;}else if(c==='-'&&next==='/'){block--;clean+='  ';i++;}else clean+=c==='\n'?'\n':' ';continue;}
    if(string){clean+=c==='\n'?'\n':' ';if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')string=false;continue;}
    if(c==='-'&&next==='-'){line=true;clean+='  ';i++;}else if(c==='/'&&next==='-'){block++;clean+='  ';i++;}else if(c==='"'){string=true;clean+=' ';}else clean+=c;
  }
  const scopes=[],names=[];
  const pattern=/^\s*(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|unsafe|public)\s+)*(namespace|section|end|theorem|lemma)\b([^\n]*)/gmu;
  for(const match of clean.matchAll(pattern)){
    const kind=match[1],name=match[2].trim().match(/^[^\s:({\[]+/u)?.[0]||'';
    if(kind==='namespace'||kind==='section'){scopes.push({kind,name});continue;}
    if(kind==='end'){
      if(name){let i=scopes.length-1;while(i>=0&&scopes[i].name!==name)i--;if(i>=0)scopes.splice(i);}
      else scopes.pop();
      continue;
    }
    if(name){const prefix=scopes.filter(s=>s.kind==='namespace').map(s=>s.name).filter(Boolean);names.push(name.startsWith('_root_.')?name.slice(7):[...prefix,name].join('.'));}
  }
  return names;
}
