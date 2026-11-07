import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=path.resolve(arg('--directory','dist/pages')),port=Number(arg('--port','8781'));
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.lean':'text/plain; charset=utf-8','.gz':'application/gzip','.wasm':'application/wasm'};
http.createServer((req,res)=>{let url;try{url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}let file=path.resolve(root,'.'+url);if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(404).end();return;}
fs.stat(file,(error,stat)=>{if(error){res.writeHead(404).end('Not found');return;}if(stat.isDirectory()){if(!url.endsWith('/')){res.writeHead(301,{Location:url+'/'}).end();return;}file=path.join(file,'index.html');}
fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res);});});}).listen(port,'127.0.0.1',()=>console.log(`Formality Pages: http://127.0.0.1:${port}/formality/`));
