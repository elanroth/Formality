import fs from 'node:fs/promises';
import path from 'node:path';
import {layoutProof,svgDocument} from './web/layout.mjs';
const [input,output,settingsFile]=process.argv.slice(2);
if(!input||!output){console.error('Usage: node render.mjs proof.json proof.svg');process.exit(1);}
const data=JSON.parse(await fs.readFile(input,'utf8'));
const settings=settingsFile?JSON.parse(await fs.readFile(settingsFile,'utf8')):{};
const layout=layoutProof(data,settings);
await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});
const svg=svgDocument(data,layout,settings);
await fs.writeFile(output,svg);
console.log(`${output}: ${layout.width} × ${Math.round(Number(svg.match(/height="([^"]+)"/)[1]))}px`);
