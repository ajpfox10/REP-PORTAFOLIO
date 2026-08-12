import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import mysql from 'mysql2/promise';

const SRC = process.argv[2] || 'D:/G/PARA ENVIAR A WSP';
const DOCU = 'D:/G/DOCU';
function walkFiles(dir){ const out=[]; for(const e of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,e.name); if(e.isDirectory()) out.push(...walkFiles(p)); else if(e.isFile()) out.push(p); } return out; }

const pdfjsFile = path.join(process.cwd(),'node_modules','pdfjs-dist','legacy','build','pdf.mjs');
const pdfjs = await import(pathToFileURL(pdfjsFile).href);

function collectDnis(text){
  const found=new Set(); const n=String(text).replace(/\s+/g,' ');
  for(const m of n.matchAll(/\b(?:20|23|24|27|30|33|34)[-\s]?(\d{7,8})[-\s]?\d\b/g)){const d=Number(m[1]); if(d>=1e6&&d<=99999999) found.add(String(d));}
  for(const m of n.matchAll(/\b(?:DNI|D\.N\.I\.|DOCUMENTO|DOC\.?|DU|CUIL)\D{0,24}(\d{7,8})\b/gi)){const d=Number(m[1]); if(d>=1e6&&d<=99999999) found.add(String(d));}
  return [...found];
}
async function pdfText(fp){
  const data=new Uint8Array(fs.readFileSync(fp));
  const pdf=await pdfjs.getDocument({data,disableWorker:true}).promise;
  let parts=[];
  for(let i=1;i<=pdf.numPages;i++){ const p=await pdf.getPage(i); const c=await p.getTextContent(); parts.push((c.items||[]).map(it=>String(it.str||'')).join(' ')); }
  await pdf.destroy?.();
  return parts.join('\n');
}
function uniqueDest(dir,base){ let t=path.join(dir,base); if(!fs.existsSync(t))return t; const ext=path.extname(base),s=path.basename(base,ext); let i=1,c; do{c=path.join(dir,`${s}_${i}${ext}`);i++;}while(fs.existsSync(c)); return c; }

const envTxt=fs.readFileSync('./.env','utf8');
const pass=(envTxt.match(/^DB_PASS(?:WORD)?=(.*)$/m)||[])[1]?.trim()||'';
const conn=await mysql.createConnection({host:'127.0.0.1',user:'root',password:pass,database:'personalv5'});
const [rows]=await conn.query('SELECT dni FROM personal WHERE deleted_at IS NULL');
await conn.end();
const dniSet=new Set(rows.map(r=>String(r.dni)));

const pdfs=walkFiles(SRC).filter(f=>f.toLowerCase().endsWith('.pdf'));
const movidos=[['origen','dni','destino']]; const revisar=[['archivo','estado','dnis']];
let moved=0, notext=0;
for(const fp of pdfs){
  const file=path.relative(SRC,fp);
  let text='';
  try{ text=await pdfText(fp); }catch{ text=''; }
  if(!text.trim()){ notext++; revisar.push([file,'sin texto (OCR pendiente)','']); continue; }
  const dnis=collectDnis(text).filter(d=>dniSet.has(d));
  if(dnis.length===1){ const dir=path.join(DOCU,dnis[0]); fs.mkdirSync(dir,{recursive:true}); const dest=uniqueDest(dir,file); fs.renameSync(fp,dest); movidos.push([file,dnis[0],dest]); moved++; }
  else revisar.push([file, dnis.length===0?'sin dni':`ambiguo x${dnis.length}`, dnis.join(' ')]);
}
const wr=(name,data)=>fs.writeFileSync(path.join(SRC,name), data.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n'),'utf8');
wr('_movidos.csv',movidos); wr('_revisar.csv',revisar);
console.log(`WSP: ${pdfs.length} pdf | movidos ${moved} | sin texto (OCR) ${notext} | revisar ${revisar.length-1}`);
