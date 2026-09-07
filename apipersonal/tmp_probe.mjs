import fs from 'node:fs'; import path from 'node:path'; import {execFileSync} from 'node:child_process';
const dnis=JSON.parse(fs.readFileSync('tmp_dnis.json','utf8')); const BASE='D:/G/DOCU';
let pdfs=[]; for(const d of dnis){const p=path.join(BASE,d); for(const e of fs.readdirSync(p,{withFileTypes:true})) if(!e.isDirectory()&&/\.pdf$/i.test(e.name)) pdfs.push(path.join(p,e.name));}
let conTexto=0,sinTexto=0,err=0; const muestras=[];
for(const f of pdfs){ try{ const t=execFileSync('pdftotext',['-f','1','-l','1','-q',f,'-'],{encoding:'latin1',timeout:20000});
  const clean=t.replace(/\s+/g,' ').trim(); if(clean.length>60){conTexto++; if(muestras.length<8)muestras.push(path.basename(f)+' >> '+clean.slice(0,180));} else sinTexto++; }catch(e){err++;} }
console.log('pdfs',pdfs.length,'conTexto',conTexto,'sinTexto(escaneo)',sinTexto,'err',err);
console.log(muestras.join('\n'));
