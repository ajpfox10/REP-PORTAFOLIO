import fs from 'node:fs';
const cache = {};
for (const s of [0,1,2]) { try { Object.assign(cache, JSON.parse(fs.readFileSync(`tmp_textos_${s}.json`,'utf8'))); } catch {} }
const sin = new Set();
for (const s of [0,1,2]) for (const l of fs.readFileSync(`tmp_mov_${s}.jsonl`,'utf8').split('\n').filter(Boolean)) {
  const o = JSON.parse(l); if (o.estado === 'sin-clasificar') sin.add(o.de);
}
const n = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
for (const pat of ['FISCALIZACION SANITARIA','SALUD OCUPACIONAL','COMPATIBILIDAD HORARIA']) {
  console.log(`\n======== ${pat} ========`);
  let k = 0;
  for (const p of sin) { const f = cache[p]; if (!f) continue; const t = n(f.texto);
    if (t.includes(pat) && k++ < 3) console.log(`-- ${f.name}: ${t.slice(0, 260)}`); }
}
