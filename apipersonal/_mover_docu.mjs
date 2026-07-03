import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const DOCU = 'D:/G/DOCU';
const FOLDERS = [
  'D:/G/CESE POR FALLECIMIENTO',
];

const NOISE = new Set([
  'art','sisa','snvs','covid','baja','seguro','seguros','asignacion','asignaciones','asig',
  'prenatal','pre','natal','escolaridad','escolar','esc','matrimonio','por','hijo','hijos','subsidio',
  'subcidio','guarderia','denuncia','siniestro','positivo','negativo','resultado','informe',
  'informes','grafico','graficos','legajo','legajos','nac','ddjj','declaracion','formulario',
  'solicitud','mail','scan','ultimo','corregido','nuevo','alta','medica','familiar','cert',
  'matricula','gdeba','hpdzgamsalgp','del','las','los','con','para','hacer','feb','viejo',
  'cori','magali','anexo','acceso','directo','image','whatsapp','nota','notas','agente','que',
  'reclamo','reclamos','haberes','asistencia','recategorizacion','reconocimiento','reconocimientos',
  'servicio','servicios','antiguedad','cbu','detalles','varios','recibidos','wsp','enviar','temporarios',
  'renuncia','renuncias','renovacion','becas','beca','fichaje','rupa','telegrama','telegramas','samo',
  'zona','desfavorable','referendum','upa',
  'planilla','bloqueo','bloqueos','ampliacion','ampliaciones','extension','titulo','pendientes','nro','expedientes',
  'domicilio','domicilios','vacunacion',
  'cedula','cedulas','reso','resolucion','abandono',
  'pagare','def','fallecimiento','cese','cargo','cesantia','notificacion','limitacion','retiro','certificacion',
]);

function stripAccents(s){ return s.normalize('NFD').replace(/[̀-ͯ]/g,''); }
function norm(s){ return stripAccents(String(s||'').toLowerCase()); }
function cleanTokens(stem){
  let toks = norm(stem).replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(Boolean);
  return toks.filter(t => /^[a-z]+$/.test(t) && t.length>=3 && !NOISE.has(t));
}
function dniCandidates(stem){
  const joined = stem.replace(/(\d)[.\s](?=\d{3}\b)/g,'$1');
  return [...new Set([...joined.matchAll(/\d{7,8}/g)].map(m=>m[0]))];
}
function uniqueDest(dir, base){
  let t = path.join(dir, base);
  if(!fs.existsSync(t)) return t;
  const ext=path.extname(base), stem=path.basename(base,ext); let i=1,c;
  do{ c=path.join(dir,`${stem}_${i}${ext}`); i++; }while(fs.existsSync(c));
  return c;
}
function walkFiles(dir){
  const out=[];
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory()) out.push(...walkFiles(p));
    else if(e.isFile()) out.push(p);
  }
  return out;
}

let dniSet, agents;
function resolveDni(name){
  let dni = dniCandidates(name).find(d=>dniSet.has(d));
  if(dni) return {dni};
  const toks = cleanTokens(name);
  if(toks.length===0) return {sinnombre:true};
  const hits = agents.filter(a=>toks.every(t=>a.norm.includes(t)));
  const uniq = [...new Map(hits.map(h=>[h.dni,h])).values()];
  if(uniq.length===1) return {dni:uniq[0].dni};
  if(uniq.length===0) return {sinmatch:true};
  return {ambiguo:uniq};
}
function moveInto(dni, srcFile){
  const dir=path.join(DOCU,dni); fs.mkdirSync(dir,{recursive:true});
  const dest=uniqueDest(dir, path.basename(srcFile));
  fs.renameSync(srcFile, dest);
  return dest;
}

const envTxt = fs.readFileSync('./.env','utf8');
const pass = (envTxt.match(/^DB_PASS(?:WORD)?=(.*)$/m)||[])[1]?.trim()||'';
const conn = await mysql.createConnection({host:'127.0.0.1',user:'root',password:pass,database:'personalv5'});
const [rows] = await conn.query("SELECT dni, apellido, nombre FROM personal WHERE deleted_at IS NULL");
await conn.end();
dniSet = new Set(rows.map(r=>String(r.dni)));
agents = rows.map(r=>({dni:String(r.dni), norm:norm((r.apellido||'')+' '+(r.nombre||'')), label:`${r.apellido}, ${r.nombre}`}));

let gMoved=0, gRevisar=0;
for(const folder of FOLDERS){
  if(!fs.existsSync(folder)){ console.log(`### ${path.basename(folder)} -> NO existe`); continue; }
  const movidos=[['origen','dni','destino']];
  const revisar=[['item','tipo','estado','candidatos']];
  let moved=0;
  for(const e of fs.readdirSync(folder,{withFileTypes:true})){
    if(e.name.startsWith('_')) continue;
    if(e.isFile() && e.name.toLowerCase().endsWith('.pdf')){
      const r=resolveDni(path.basename(e.name,'.pdf'));
      if(r.dni){ const d=moveInto(r.dni, path.join(folder,e.name)); movidos.push([e.name,r.dni,d]); moved++; }
      else revisar.push([e.name,'pdf', r.sinnombre?'sin nombre':r.sinmatch?'sin match':`ambiguo x${r.ambiguo.length}`, r.ambiguo?r.ambiguo.slice(0,6).map(u=>`${u.dni} ${u.label}`).join(' | '):'']);
    } else if(e.isDirectory()){
      const r=resolveDni(e.name);
      if(r.dni){
        for(const f of walkFiles(path.join(folder,e.name))){ const d=moveInto(r.dni,f); movidos.push([path.relative(folder,f),r.dni,d]); moved++; }
      } else revisar.push([e.name,'carpeta', r.sinnombre?'sin nombre':r.sinmatch?'sin match':`ambiguo x${r.ambiguo.length}`, r.ambiguo?r.ambiguo.slice(0,6).map(u=>`${u.dni} ${u.label}`).join(' | '):'']);
    }
  }
  const wr=(name,data)=>fs.writeFileSync(path.join(folder,name), data.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n'),'utf8');
  wr('_movidos.csv',movidos); wr('_revisar.csv',revisar);
  gMoved+=moved; gRevisar+=revisar.length-1;
  console.log(`### ${path.basename(folder)}: movidos ${moved} | revisar ${revisar.length-1}`);
}
console.log(`\n===== TOTAL: movidos ${gMoved} | revisar ${gRevisar} =====`);
