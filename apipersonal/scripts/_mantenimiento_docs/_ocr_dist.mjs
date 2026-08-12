import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import mysql from 'mysql2/promise';

const SRC = process.argv[2];
const DOCU = 'D:/G/DOCU';
const OCR_MAX_PAGES = 2;
if(!SRC){ console.error('uso: node _ocr_dist.mjs "<carpeta>"'); process.exit(1); }

const pdfjs = await import(pathToFileURL(path.join(process.cwd(),'node_modules','pdfjs-dist','legacy','build','pdf.mjs')).href);
const canvasMod = await import('@napi-rs/canvas');
const { createCanvas, DOMMatrix, Path2D, ImageData } = canvasMod;
globalThis.DOMMatrix = globalThis.DOMMatrix ?? DOMMatrix;
globalThis.Path2D = globalThis.Path2D ?? Path2D;
globalThis.ImageData = globalThis.ImageData ?? ImageData;
const { createWorker } = await import('tesseract.js');

class NapiCanvasFactory {
  create(w, h){ const canvas = createCanvas(Math.max(1,w), Math.max(1,h)); return { canvas, context: canvas.getContext('2d') }; }
  reset(cc, w, h){ cc.canvas.width = Math.max(1,w); cc.canvas.height = Math.max(1,h); }
  destroy(cc){ try{ cc.canvas.width = 0; cc.canvas.height = 0; }catch{} cc.canvas = null; cc.context = null; }
}
const canvasFactory = new NapiCanvasFactory();

function collectDnis(text){
  const found=new Set(); const n=String(text).replace(/\s+/g,' ');
  for(const m of n.matchAll(/\b(?:20|23|24|27|30|33|34)[-\s]?(\d{7,8})[-\s]?\d\b/g)){const d=Number(m[1]); if(d>=1e6&&d<=99999999) found.add(String(d));}
  for(const m of n.matchAll(/\b(?:DNI|D\.N\.I\.|DOCUMENTO|DOC\.?|DU|CUIL)\D{0,24}(\d{7,8})\b/gi)){const d=Number(m[1]); if(d>=1e6&&d<=99999999) found.add(String(d));}
  return [...found];
}
function walkFiles(dir){ const o=[]; for(const e of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,e.name); if(e.isDirectory()) o.push(...walkFiles(p)); else if(e.isFile()) o.push(p);} return o; }
function uniqueDest(dir,base){ let t=path.join(dir,base); if(!fs.existsSync(t))return t; const ext=path.extname(base),s=path.basename(base,ext); let i=1,c; do{c=path.join(dir,`${s}_${i}${ext}`);i++;}while(fs.existsSync(c)); return c; }

async function textLayer(fp){
  try{ const data=new Uint8Array(fs.readFileSync(fp)); const pdf=await pdfjs.getDocument({data,disableWorker:true}).promise;
    let parts=[]; for(let i=1;i<=pdf.numPages;i++){ const p=await pdf.getPage(i); const c=await p.getTextContent(); parts.push((c.items||[]).map(it=>String(it.str||'')).join(' ')); }
    await pdf.destroy?.(); return parts.join('\n'); }catch{ return ''; }
}
async function ocrText(fp, worker){
  let out='';
  try{
    const data=new Uint8Array(fs.readFileSync(fp)); const pdf=await pdfjs.getDocument({data,disableWorker:true,canvasFactory}).promise;
    const pages=Math.min(pdf.numPages, OCR_MAX_PAGES);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ocr-'));
    for(let i=1;i<=pages;i++){
      const page=await pdf.getPage(i); const vp=page.getViewport({scale:2});
      const canvas=createCanvas(Math.ceil(vp.width),Math.ceil(vp.height)); const ctx=canvas.getContext('2d');
      ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
      await page.render({canvasContext:ctx, viewport:vp}).promise;
      const jpgPath=path.join(tmp,`p${i}.jpg`); fs.writeFileSync(jpgPath, await canvas.encode('jpeg',90));
      const { data:{ text } } = await worker.recognize(jpgPath);
      out += '\n'+(text||'');
      if(collectDnis(out).length) break;
    }
    await pdf.destroy?.(); fs.rmSync(tmp,{recursive:true,force:true});
  }catch{}
  return out;
}

const envTxt=fs.readFileSync('./.env','utf8');
const pass=(envTxt.match(/^DB_PASS(?:WORD)?=(.*)$/m)||[])[1]?.trim()||'';
const conn=await mysql.createConnection({host:'127.0.0.1',user:'root',password:pass,database:'personalv5'});
const [rows]=await conn.query('SELECT dni FROM personal WHERE deleted_at IS NULL'); await conn.end();
const dniSet=new Set(rows.map(r=>String(r.dni)));

const worker=await createWorker('spa');
const FOLDERS = process.argv.slice(2);
let gMoved=0, gRev=0;
for(const SRC of FOLDERS){
  if(!fs.existsSync(SRC)){ console.log(`### ${path.basename(SRC)} -> NO existe`); continue; }
  const pdfs=walkFiles(SRC).filter(f=>f.toLowerCase().endsWith('.pdf'));
  const movidos=[['origen','dni','via','destino']]; const revisar=[['archivo','estado','dnis']];
  let moved=0, viaTxt=0, viaOcr=0;
  for(const fp of pdfs){
    const file=path.relative(SRC,fp);
    let via='texto', dnis=collectDnis(await textLayer(fp)).filter(d=>dniSet.has(d));
    if(dnis.length!==1){ const t=await ocrText(fp,worker); const od=collectDnis(t).filter(d=>dniSet.has(d)); if(od.length===1){ dnis=od; via='ocr'; } }
    if(dnis.length===1){ const dir=path.join(DOCU,dnis[0]); fs.mkdirSync(dir,{recursive:true}); const dest=uniqueDest(dir,path.basename(fp)); fs.renameSync(fp,dest); movidos.push([file,dnis[0],via,dest]); moved++; via==='ocr'?viaOcr++:viaTxt++; }
    else revisar.push([file, dnis.length===0?'sin dni':`ambiguo x${dnis.length}`, dnis.join(' ')]);
  }
  const wr=(name,data)=>fs.writeFileSync(path.join(SRC,name), data.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n'),'utf8');
  wr('_movidos_ocr.csv',movidos); wr('_revisar_ocr.csv',revisar);
  gMoved+=moved; gRev+=revisar.length-1;
  console.log(`### ${path.basename(SRC)}: ${pdfs.length} pdf | movidos ${moved} (txt ${viaTxt}, ocr ${viaOcr}) | revisar ${revisar.length-1}`);
}
await worker.terminate();
console.log(`\n===== OCR TOTAL: movidos ${gMoved} | revisar ${gRev} =====`);
