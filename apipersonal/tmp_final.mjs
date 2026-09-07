import fs from 'node:fs'; import path from 'node:path';
const dnis = JSON.parse(fs.readFileSync('tmp_dnis.json','utf8')); const BASE='D:/G/DOCU';
const IGNORAR = /\.(db|lnk|tmp|ini)$/i;
let sueltos=0, ignorados=0, enSub=0; const porSub={};
for (const d of dnis) { const dir=path.join(BASE,d);
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    if (e.isDirectory()) { const n=fs.readdirSync(path.join(dir,e.name)).length; enSub+=n; porSub[e.name]=(porSub[e.name]||0)+n; }
    else if (IGNORAR.test(e.name)) ignorados++; else sueltos++;
  }}
const movidos = ['tmp_mov_pasada1.jsonl','tmp_mov_pasada2.jsonl','tmp_mov_0.jsonl','tmp_mov_1.jsonl','tmp_mov_2.jsonl']
  .filter(f=>fs.existsSync(f)).flatMap(f=>fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(JSON.parse))
  .filter(o=>o.estado==='movido');
console.log('MOVIDOS registrados en log:', movidos.length);
console.log('destinos que ya no existen en disco:', movidos.filter(m=>!fs.existsSync(m.a)).length);
console.log('origenes que reaparecieron (no deberia haber):', movidos.filter(m=>fs.existsSync(m.de)).length);
console.log('\nEstado actual de las carpetas de los 95 agentes:');
console.log('  sueltos en la raiz:', sueltos, '| ignorados (Thumbs.db/.lnk/.tmp):', ignorados, '| dentro de subcarpetas:', enSub);
console.log('  total archivos:', sueltos+ignorados+enSub, '(al inicio habia 1110 sueltos + los que ya estaban en subcarpetas)');
console.log('\nSubcarpetas de las 17 estandar, contenido actual:');
const EST=['DNI','CUIL','Titulo','Curriculum','Certificado ant. Nacionales','Certificado ant. Provinciales','Certificado Apto Psicofisico','Certificado de aportantes (IPS)','Caratula SIAPE','Constancia de Aceptacion SIAPE','DDJJ Cond. De Salud','Declaracion jurada','Planilla de datos personales','Planilla de incompatibilidad','Etico (si lo tuviere)','Libre de deuda (RDAM)','Matricula (si la tuviere)'];
for (const k of EST) console.log(String(porSub[k]||0).padStart(5), k);
