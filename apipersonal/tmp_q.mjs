import mysql from 'mysql2/promise'; import fs from 'node:fs'; import path from 'node:path';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')), l.slice(l.indexOf('=')+1)]));
const c = await mysql.createConnection({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME});
const [rows] = await c.query("select dni from tramites_tanda_interinos where tanda='prueba' order by dni");
await c.end();
const dnis = rows.map(r=>String(r.dni));
fs.writeFileSync('tmp_dnis.json', JSON.stringify(dnis));
const BASE='D:/G/DOCU';
let sinCarpeta=0, conCarpeta=0; const subdirs={}, exts={}; let files=0, sueltos=0;
for (const d of dnis){ const p=path.join(BASE,d);
  if(!fs.existsSync(p)){sinCarpeta++;continue;} conCarpeta++;
  for(const e of fs.readdirSync(p,{withFileTypes:true})){
    if(e.isDirectory()) subdirs[e.name]=(subdirs[e.name]||0)+1;
    else {files++; sueltos++; exts[path.extname(e.name).toLowerCase()]=(exts[path.extname(e.name).toLowerCase()]||0)+1;}
  }}
console.log('total',dnis.length,'conCarpeta',conCarpeta,'sinCarpeta',sinCarpeta);
console.log('archivos sueltos en raiz:',sueltos, JSON.stringify(exts));
console.log('subcarpetas:', JSON.stringify(Object.entries(subdirs).sort((a,b)=>b[1]-a[1])));
