import fs from 'node:fs';
const cache = {};
for (const s of [0,1,2]) { try { Object.assign(cache, JSON.parse(fs.readFileSync(`tmp_textos_${s}.json`,'utf8'))); } catch {} }
const sinCl = new Set();
for (const s of [0,1,2]) { try {
  for (const l of fs.readFileSync(`tmp_mov_${s}.jsonl`,'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(l); if (o.estado === 'sin-clasificar') sinCl.add(o.de);
  }} catch {} }
const filas = [...sinCl].map(p => cache[p]).filter(Boolean);
console.log('sin clasificar:', filas.length, '| texto vacio/inutil (<40 chars):', filas.filter(f => (f.texto||'').trim().length < 40).length);
const n = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ');
for (const f of filas.slice(0, 25)) console.log(`\n### ${f.name} [${f.origen}] :: ${n(f.texto).slice(0, 150)}`);
