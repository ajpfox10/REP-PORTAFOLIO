import fs from 'fs';
import path from 'path';

const DEST_BASE = 'D:/G/PENDIENTE DE CLASIFICAR';
const FOLDERS = [
  'D:/G/ART','D:/G/ASIGNACION FAMILIAR','D:/G/BAJA DE SEGUROS','D:/G/COVID ART',
  'D:/G/NOTAS DE RECLAMOS','D:/G/Recibidos de Legajos','D:/G/RECLAMO RECATEGORIZACION',
  'D:/G/RECLAMOS ASISTENCIA','D:/G/RECLAMOS HABERES','D:/G/RECONOCIMIENTO DE SERVICIO 2023',
  'D:/G/RECONOCIMIENTOS DE ANTIGUEDAD','D:/G/RECONOCIMIENTOS DE SERVICIOS TEMPORARIOS',
  'D:/G/RENUNCIAS','D:/G/TELEGRAMAS','D:/G/AD REFERENDUM','D:/G/zona desfavorable',
  'D:/G/CEDULAS','D:/G/CESE POR FALLECIMIENTO','D:/G/PARA ENVIAR A WSP',
  'D:/G/RENOVACION BECAS 2026','D:/G/BLOQUEO DE TÍTULO Y EXTENSIÓN A 48 HS',
  'D:/G/INFORMES GRAFICOS LEGAJOS','D:/G/JUBILACIONES','D:/G/CAMBIOS DE DOMICILIO/domicilio intranet',
];
// No mover: mis CSV/logs, archivos de sistema
const SKIP = (name) => name.startsWith('_') || /^(thumbs\.db|desktop\.ini)$/i.test(name) || name.startsWith('~$');

function walk(dir){ const o=[]; for(const e of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,e.name); if(e.isDirectory()) o.push(...walk(p)); else if(e.isFile()) o.push(p);} return o; }
function uniqueDest(fp){ if(!fs.existsSync(fp))return fp; const d=path.dirname(fp),ext=path.extname(fp),s=path.basename(fp,ext); let i=1,c; do{c=path.join(d,`${s}_${i}${ext}`);i++;}while(fs.existsSync(c)); return c; }

let moved=0;
const log=[['origen','destino']];
for(const folder of FOLDERS){
  if(!fs.existsSync(folder)) continue;
  const label = path.basename(folder);
  for(const fp of walk(folder)){
    const name = path.basename(fp);
    if(SKIP(name)) continue;
    const rel = path.relative(folder, fp);
    const dest = uniqueDest(path.join(DEST_BASE, label, rel));
    fs.mkdirSync(path.dirname(dest), { recursive:true });
    fs.renameSync(fp, dest);
    log.push([fp, dest]); moved++;
  }
}
fs.mkdirSync(DEST_BASE,{recursive:true});
fs.writeFileSync(path.join(DEST_BASE,'_consolidado.csv'), log.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n'),'utf8');
console.log(`Consolidados a PENDIENTE DE CLASIFICAR: ${moved} archivos. Log en _consolidado.csv`);
