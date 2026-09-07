import fs from 'node:fs';
const cache = {};
for (const s of [0,1,2]) { try { Object.assign(cache, JSON.parse(fs.readFileSync(`tmp_textos_${s}.json`,'utf8'))); } catch {} }
const sin = [], err = [];
for (const s of [0,1,2]) for (const l of fs.readFileSync(`tmp_mov_${s}.jsonl`,'utf8').split('\n').filter(Boolean)) {
  const o = JSON.parse(l);
  if (o.estado === 'sin-clasificar') sin.push(o.de);
  if (o.estado.startsWith('error')) err.push(o);
}
console.log('sin clasificar:', sin.length, '| errores:', err.length);
console.log('--- errores ---');
for (const e of err.slice(0,6)) console.log(e.de.slice(-55), '::', (e.error||'').slice(0,90));
const n = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const filas = sin.map(p => cache[p]).filter(Boolean);
console.log('--- sin texto util (<40 chars):', filas.filter(f => n(f.texto).length < 40).length, '---');
console.log('--- primeras palabras de los sin clasificar (agrupadas) ---');
const g = {};
for (const f of filas) { const k = n(f.texto).slice(0,45) || '(vacio)'; g[k] = (g[k]||0)+1; }
for (const [k,v] of Object.entries(g).sort((a,b)=>b[1]-a[1]).slice(0,28)) console.log(String(v).padStart(4), k);
