import fs from 'fs';
import mysql from 'mysql2/promise';
const LF='D:/G/DOCU/.personalv5/tramites-documentales-listados.json';
const data=JSON.parse(fs.readFileSync(LF,'utf8'));
const dnis=new Set();
for(const l of data) for(const r of (l.rows||[])) if(r&&r.dni) dnis.add(String(r.dni).replace(/\D/g,''));
const env=fs.readFileSync('./.env','utf8'); const pass=(env.match(/^DB_PASS(?:WORD)?=(.*)$/m)||[])[1].trim();
const conn=await mysql.createConnection({host:'127.0.0.1',user:'root',password:pass,database:'personalv5'});
const [rows]=await conn.query('SELECT p.dni, oc.nombre AS ocup, l.nombre AS ley FROM personal p JOIN agentes a ON a.dni=p.dni AND a.deleted_at IS NULL LEFT JOIN ocupaciones oc ON oc.id=a.ocupacion_id AND oc.deleted_at IS NULL LEFT JOIN ley l ON l.id=oc.ley_id WHERE p.dni IN (?)', [[...dnis]]);
await conn.end();
const map=new Map(rows.map(r=>[String(r.dni), r.ocup]));
fs.copyFileSync(LF, LF+'.bak_'+Date.now());
let changed=0, sample=[];
for(const l of data) for(const r of (l.rows||[])){
  if(!r) continue;
  const d=String(r.dni||'').replace(/\D/g,'');
  if(map.has(d) && map.get(d) && r.ocupacionNombre!==map.get(d)){
    if(sample.length<8) sample.push(`${d}: ${r.ocupacionNombre} -> ${map.get(d)}`);
    r.ocupacionNombre=map.get(d); changed++;
  }
}
fs.writeFileSync(LF, JSON.stringify(data,null,2),'utf8');
console.log('listados:', data.length, '| filas corregidas:', changed);
sample.forEach(s=>console.log('  '+s));
