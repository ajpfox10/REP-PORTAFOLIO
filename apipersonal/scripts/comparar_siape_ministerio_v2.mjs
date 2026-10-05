// comparar_siape_ministerio_v2.mjs  —  Comparador SIAPE vs Ministerio 2.0 (robot)
//
// Hace la MISMA comparacion que el boton del Comparador SIAPE (src/routes/comparacionSiape.routes.ts,
// que queda como esta: version vieja) pero en vez de dejar el resultado en pantalla / Excel lo guarda
// en tablas, con historial (una corrida por ejecucion):
//   comparacion_corridas   -> 1 fila por corrida: archivos usados, totales
//   comparacion_novedades  -> 1 fila por novedad comparada (lo que hoy es cada fila del comparador)
//
// Entradas (LICENCIAS_PDF_DIR, default D:\G\comparacion):
//   MINISTERIO\  -> MINISTERIO.* (Hospital) + UPA4.* + UPA18.* juntos (el viejo usaba un solo
//                   archivo: el 1ro alfabetico)
//   SIAPE\       -> idem
//   tabla mapeo_novedades (activo = 1)
//
// Uso: node comparar_siape_ministerio_v2.mjs
// Ultima linea: JSON {"ok":true,"corrida":N,...} (la toma run_robot como resumen)

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(appRoot, '.env') });

const BASE_DIR = process.env.LICENCIAS_PDF_DIR || 'D:\\G\\comparacion';
const REGLAS_SOLO_V2 = { '28-INASISTENCIA': ['AUSENTE SIN AVISO'] };

// ── Utilidades (copia fiel del comparador viejo) ───────────────────────────────

function normNovedad(s) {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\.\s*/g, '.');
}
const normDni = (v) => String(v ?? '').replace(/[^0-9]/g, '').trim();
function normLegajo(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '-') return '';
  return s.replace(/\D/g, '');
}
function normMapeo(mapeo) {
  const out = {};
  for (const [k, arr] of Object.entries(mapeo || {})) {
    out[normNovedad(k)] = Array.from(new Set((arr || []).map(normNovedad))).filter(Boolean);
  }
  return out;
}
function splitNovedadesCompuestas(v) {
  const base = normNovedad(v);
  if (!base) return [];
  return Array.from(new Set([base, ...base.split(/\s+\/\s+/).map(normNovedad)].filter(Boolean)));
}
function novedadesConectan(equivs, novSiap) {
  const siapParts = splitNovedadesCompuestas(novSiap);
  return equivs.some((e) => siapParts.includes(normNovedad(e)));
}
function equivsMinisterio(mapeoN, novMinNorm) {
  return Array.from(new Set([novMinNorm, ...(mapeoN[novMinNorm] || [])].filter(Boolean)));
}
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const iso = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
const dateToStr = (d) => (d ? d.toISOString().slice(0, 10) : '');
const toUTCMid = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const overlap = (s1, e1, s2, e2) => toUTCMid(s1) <= toUTCMid(e2) && toUTCMid(s2) <= toUTCMid(e1);

function resolveDepedencia(e5raw, e6raw) {
  const norm = (s) => String(s ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const e6 = norm(e6raw);
  const e5 = norm(e5raw);
  const inE6 = e6.match(/UPA\s*(\d+)/) ?? e6.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (inE6) return `UPA ${inE6[1]}`;
  const inE5 = e5.match(/UPA\s*(\d+)/) ?? e5.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (inE5) return `UPA ${inE5[1]}`;
  return 'HOSPITAL';
}

// 2.0: el Excel MAS NUEVO de la carpeta (no el primero alfabetico)
function excelMasNuevo(dir, nombre = /./) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => !f.startsWith('~$') && !f.startsWith('.') && /\.(xlsx|xls|xltx)$/i.test(f) && nombre.test(f))
    .map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? files[0] : null;
}

function leerHoja(fp) {
  const wb = XLSX.read(fs.readFileSync(fp), { type: 'buffer', cellDates: false, raw: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
}
function columnas(raw) {
  const hdr = raw[0].map((h) => String(h ?? '').toLowerCase().trim());
  return (keys) => { for (const k of keys) { const i = hdr.indexOf(k); if (i >= 0) return i; } return -1; };
}

function parseExcelMinisterio(fp) {
  const raw = leerHoja(fp);
  const rows = [];
  if (raw.length < 2) return rows;
  const ci = columnas(raw);
  const cLeg = ci(['legajo']);
  const cDni = ci(['nro documento', 'nro_documento', 'dni', 'documento']);
  const cNom = ci(['apellido y nombres', 'apellido y nombre', 'nombre']);
  const cNov = ci(['novedad']);
  const cDesde = ci(['fecha desde', 'fecha_desde', 'desde']);
  const cHasta = ci(['fecha hasta', 'fecha_hasta', 'hasta']);
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const legajo = normLegajo(cLeg >= 0 ? r[cLeg] : '');
    const dni = normDni(cDni >= 0 ? r[cDni] : '');
    const nombre = String(cNom >= 0 ? (r[cNom] ?? '') : '').trim();
    const novedad = String(cNov >= 0 ? (r[cNov] ?? '') : '').trim();
    const desde = parseDate(cDesde >= 0 ? r[cDesde] : null);
    const hasta = parseDate(cHasta >= 0 ? r[cHasta] : null);
    if (!legajo && !dni && !nombre) continue;
    rows.push({ legajo, dni, nombre, novedad, desde, hasta, dependencia: '—', ley: '', justificado: '' });
  }
  return rows;
}

function parseExcelSiape(fp) {
  const raw = leerHoja(fp);
  const rows = [];
  if (raw.length < 2) return rows;
  const ci = columnas(raw);
  const cLeg = ci(['legajo']);
  const cDni = ci(['nro_documento', 'nro documento', 'dni']);
  const cAp = ci(['apellido']);
  const cNom = ci(['nombre']);
  const cNov = ci(['novedad']);
  const cDesde = ci(['fecha_desde', 'fecha desde', 'desde']);
  const cHasta = ci(['fecha_hasta', 'fecha hasta', 'hasta']);
  const cE5 = ci(['e5']);
  const cE6 = ci(['e6']);
  const cLey = ci(['ley', 'convenio', 'regimen', 'planta', 'categoria']);
  const cJust = ci(['justificado']);
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const legajo = normLegajo(cLeg >= 0 ? r[cLeg] : '');
    const dni = normDni(cDni >= 0 ? r[cDni] : '');
    const ap = String(cAp >= 0 ? (r[cAp] ?? '') : '').trim();
    const nm = String(cNom >= 0 ? (r[cNom] ?? '') : '').trim();
    const nombre = ap && nm ? `${ap}, ${nm}` : (ap || nm);
    const novedad = String(cNov >= 0 ? (r[cNov] ?? '') : '').trim();
    const desde = parseDate(cDesde >= 0 ? r[cDesde] : null);
    const hasta = parseDate(cHasta >= 0 ? r[cHasta] : null);
    const dependencia = resolveDepedencia(String(cE5 >= 0 ? (r[cE5] ?? '') : ''), String(cE6 >= 0 ? (r[cE6] ?? '') : ''));
    const ley = String(cLey >= 0 ? (r[cLey] ?? '') : '').trim();
    const justificado = String(cJust >= 0 ? (r[cJust] ?? '') : '').trim().toUpperCase();
    if (!novedad) continue;
    rows.push({ legajo, dni, nombre, novedad, desde, hasta, dependencia, ley, justificado });
  }
  return sinRepetidas(rows);
}

// La misma novedad cargada dos veces en SIAPE (mismo agente, novedad y fechas) cuenta UNA sola:
// si no, la copia queda suelta como "solo SIAPE", el robot la carga y suma una copia mas en el
// Ministerio en cada pasada (caso LOPEZ, duelo 18/09: 5 copias). 04/10/2026.
function sinRepetidas(rows) {
  const vistas = new Set();
  let repetidas = 0;
  const out = rows.filter((r) => {
    const clave = [r.dni || r.legajo, normNovedad(r.novedad), r.desde || '', r.hasta || ''].join('|');
    if (vistas.has(clave)) { repetidas++; return false; }
    vistas.add(clave);
    return true;
  });
  if (repetidas) console.log(`SIAPE: ${repetidas} fila(s) repetida(s) (misma novedad, agente y fechas) contadas una sola vez.`);
  return out;
}

// ── Examen automatico tras pre-examen ─────────────────────────────────────────
const MOTIVO_EXAMEN_AUTO = 'EXAMEN_AUTOMATICO_TRAS_PREEXAMEN';
function examenesAutomaticos(siap) {
  const DIA = 86400000;
  const cubre = (r, t) => {
    const d = r.desde ? toUTCMid(r.desde).getTime() : NaN;
    const h = r.hasta ? toUTCMid(r.hasta).getTime() : d;
    return d <= t && t <= h;
  };
  const porDni = {};
  for (const r of siap) if (r.dni) (porDni[r.dni] ||= []).push(r);
  const out = [];
  const hechos = new Set();
  for (const pre of siap) {
    if (normNovedad(pre.novedad) !== 'PRE-EXAMEN' || !pre.dni) continue;
    const fin = pre.hasta ?? pre.desde;
    if (!fin) continue;
    const dia = toUTCMid(fin).getTime() + DIA;
    const delAgente = porDni[pre.dni] || [];
    if (delAgente.some((r) => normNovedad(r.novedad) === 'PRE-EXAMEN' && cubre(r, dia))) continue;
    if (delAgente.some((r) => normNovedad(r.novedad) === 'EXAMEN' && cubre(r, dia))) continue;
    const k = `${pre.dni}|${dia}`;
    if (hechos.has(k)) continue;
    hechos.add(k);
    out.push({ ...pre, novedad: 'EXAMEN', desde: new Date(dia), hasta: new Date(dia), justificado: 'SI', auto: MOTIVO_EXAMEN_AUTO });
  }
  return out;
}

// ── Reglas de becario / medicas sin justificar ────────────────────────────────
const esBecario = (ley) => ley.toUpperCase().includes('BECARIO') || ley.toUpperCase().includes('BECA');
function diasEntreFechas(desde, hasta) {
  if (!desde || !hasta) return 0;
  return Math.round((toUTCMid(hasta).getTime() - toUTCMid(desde).getTime()) / 86400000) + 1;
}
function esVacaciones(novedad) {
  const n = normNovedad(novedad);
  return n.includes('ANUAL') || n.includes('VACACION') || n.includes('DESCANSO ANUAL');
}
function esLicencia29(novedad) {
  const n = normNovedad(novedad);
  return n.startsWith('29') || (n.includes('COMPLEMENT') && n.includes('29'));
}
function motivoBecario(ley, novedad, desde, hasta) {
  if (!esBecario(ley)) return null;
  if (esLicencia29(novedad)) return 'BECARIO_NO_APLICA';
  if (esVacaciones(novedad) && diasEntreFechas(desde, hasta) > 14) return 'BECARIO_NO_APLICA';
  return null;
}
const NOV_ENF_PENDIENTE = 'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCION)';
function esMedicaSinJustificar(row) {
  if (String(row.justificado || '').trim().toUpperCase() !== 'NO') return false;
  const n = normNovedad(row.novedad);
  return n.startsWith('ENFERMEDAD') || n.includes('ATENCION FAMILIAR ENFERMO') || n.includes('ENFERMEDAD DE FAMILIAR');
}
const novedadSiapParaComparar = (row) => (esMedicaSinJustificar(row) ? NOV_ENF_PENDIENTE : row.novedad);
const novedadesConectanRow = (equivs, row) => novedadesConectan(equivs, novedadSiapParaComparar(row));
const dia = (d) => Math.floor(toUTCMid(d).getTime() / 86400000);
function rangoCubierto(desde, hasta, filas) {
  if (!desde || !hasta || filas.length === 0) return false;
  const ini = dia(desde);
  const fin = dia(hasta);
  const tramos = filas
    .map((f) => { const d = f.desde; const h = f.hasta ?? f.desde; return d && h ? [Math.max(ini, dia(d)), Math.min(fin, dia(h))] : null; })
    .filter((x) => !!x && x[0] <= x[1])
    .sort((a, b) => a[0] - b[0]);
  let cubreHasta = ini - 1;
  for (const [a, b] of tramos) {
    if (a > cubreHasta + 1) return false;
    cubreHasta = Math.max(cubreHasta, b);
    if (cubreHasta >= fin) return true;
  }
  return cubreHasta >= fin;
}

// ── Comparacion (copia fiel) ─────────────────────────────────────────────────
function comparar(ministerio, siap, mapeo) {
  const mapeoN = normMapeo(mapeo);
  const siapByLeg = {};
  const siapByDni = {};
  for (const s of siap) {
    if (s.legajo) (siapByLeg[s.legajo] = siapByLeg[s.legajo] || []).push(s);
    if (s.dni) (siapByDni[s.dni] = siapByDni[s.dni] || []).push(s);
  }
  const resultados = [];
  const siapVisto = new Set();

  for (const min of ministerio) {
    const novNorm = normNovedad(min.novedad);
    const equivs = equivsMinisterio(mapeoN, novNorm);
    const candidatos = (siapByDni[min.dni] || []).length
      ? siapByDni[min.dni]
      : (min.legajo ? (siapByLeg[min.legajo] || []) : []);
    const depRef = candidatos[0]?.dependencia ?? '—';
    const minDesde = min.desde;
    const minHasta = min.hasta ?? min.desde;
    let vioNovedadMapeada = false;
    let vioRangoDist = false;
    let bestCand = null;

    const match = candidatos.find((s) => {
      if (!novedadesConectanRow(equivs, s)) return false;
      vioNovedadMapeada = true;
      const sD = s.desde;
      const sH = s.hasta ?? s.desde;
      if (!minDesde || !minHasta || !sD || !sH) return false;
      const exact = toUTCMid(minDesde).getTime() === toUTCMid(sD).getTime() &&
        toUTCMid(minHasta).getTime() === toUTCMid(sH).getTime();
      if (!exact) { if (!bestCand) bestCand = s; vioRangoDist = true; }
      return exact;
    });

    const medicasPendientesCubiertas = !match
      ? candidatos.filter((s) => {
          if (siapVisto.has(s) || !esMedicaSinJustificar(s) || !novedadesConectanRow(equivs, s)) return false;
          const sD = s.desde;
          const sH = s.hasta ?? s.desde;
          return !!minDesde && !!minHasta && !!sD && !!sH && overlap(minDesde, minHasta, sD, sH);
        })
      : [];
    const cubreMedicaPendiente = rangoCubierto(minDesde, minHasta, medicasPendientesCubiertas);

    if (match) siapVisto.add(match);
    else if (cubreMedicaPendiente) medicasPendientesCubiertas.forEach((s) => siapVisto.add(s));
    else if (bestCand) siapVisto.add(bestCand);

    const display = match ?? medicasPendientesCubiertas[0] ?? bestCand;
    const estado = match || cubreMedicaPendiente ? 'COINCIDENTE' : vioRangoDist ? 'RANGO_DISTINTO' : 'NO COINCIDENTE';
    const motivo = match ? '' : cubreMedicaPendiente ? 'MEDICA_SIN_JUSTIFICAR_CUBIERTA_POR_PENDIENTE'
      : vioRangoDist ? 'RANGO_DISTINTO' : vioNovedadMapeada ? 'MAPEO_OK_PERO_SIN_MATCH' : 'SIAP_SIN_NOVEDAD_EQUIVALENTE';
    const leyRef = display?.ley ?? candidatos[0]?.ley ?? '';
    resultados.push({
      legajo: min.legajo, dni: min.dni, nombre: min.nombre,
      dependencia: display?.dependencia ?? depRef, ley: leyRef,
      novedad_ministerio: min.novedad,
      fecha_desde_min: dateToStr(min.desde), fecha_hasta_min: dateToStr(min.hasta),
      novedad_siap: display?.novedad ?? '—',
      fecha_desde_siap: dateToStr(display?.desde ?? null), fecha_hasta_siap: dateToStr(display?.hasta ?? null),
      justificado_siap: display?.justificado ?? '',
      estado, motivo,
    });
  }

  for (const s of siap) {
    if (siapVisto.has(s)) continue;
    const novNorm = normNovedad(s.novedad);
    const tieneMapeo = Object.values(mapeoN).some((arr) => arr.includes(novNorm)) || Object.keys(mapeoN).includes(novNorm);
    if (!tieneMapeo) continue;
    const motivoSiap = s.auto ?? motivoBecario(s.ley, s.novedad, s.desde, s.hasta) ?? 'EN_SIAP_SIN_MINISTERIO';
    resultados.push({
      legajo: s.legajo, dni: s.dni, nombre: s.nombre, dependencia: s.dependencia, ley: s.ley,
      novedad_ministerio: '—', fecha_desde_min: '—', fecha_hasta_min: '—',
      novedad_siap: s.novedad, fecha_desde_siap: dateToStr(s.desde), fecha_hasta_siap: dateToStr(s.hasta),
      justificado_siap: s.justificado ?? '',
      estado: 'SOLO_SIAP', motivo: motivoSiap,
    });
  }
  return resultados;
}

// ── Base de datos ────────────────────────────────────────────────────────────
async function crearTablas(cn) {
  await cn.query(`
    CREATE TABLE IF NOT EXISTS comparacion_corridas (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archivo_ministerio VARCHAR(300) NOT NULL,
      ministerio_modificado DATETIME NULL,
      archivo_siape VARCHAR(300) NOT NULL,
      siape_modificado DATETIME NULL,
      total_ministerio INT NOT NULL DEFAULT 0,
      total_siap_con_novedad INT NOT NULL DEFAULT 0,
      coincidentes INT NOT NULL DEFAULT 0,
      rango_distinto INT NOT NULL DEFAULT 0,
      no_coincidentes INT NOT NULL DEFAULT 0,
      solo_siap INT NOT NULL DEFAULT 0,
      examenes_automaticos INT NOT NULL DEFAULT 0,
      examenes_automaticos_a_cargar INT NOT NULL DEFAULT 0,
      duracion_ms INT NULL,
      PRIMARY KEY (id),
      KEY idx_comparacion_corridas__fecha (creado_en)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await cn.query(`
    CREATE TABLE IF NOT EXISTS comparacion_novedades (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      corrida_id INT UNSIGNED NOT NULL,
      estado ENUM('COINCIDENTE','NO COINCIDENTE','RANGO_DISTINTO','SOLO_SIAP') NOT NULL,
      motivo VARCHAR(80) NOT NULL DEFAULT '',
      dependencia VARCHAR(20) NOT NULL DEFAULT '',
      ley VARCHAR(120) NOT NULL DEFAULT '',
      legajo VARCHAR(20) NOT NULL DEFAULT '',
      dni VARCHAR(12) NOT NULL DEFAULT '',
      nombre VARCHAR(160) NOT NULL DEFAULT '',
      novedad_ministerio VARCHAR(160) NOT NULL DEFAULT '',
      desde_ministerio DATE NULL,
      hasta_ministerio DATE NULL,
      novedad_siap VARCHAR(160) NOT NULL DEFAULT '',
      desde_siap DATE NULL,
      hasta_siap DATE NULL,
      justificado_siap VARCHAR(10) NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      KEY idx_comparacion_novedades__corrida (corrida_id, estado, dependencia),
      KEY idx_comparacion_novedades__dni (dni),
      CONSTRAINT fk_comparacion_novedades__corrida FOREIGN KEY (corrida_id)
        REFERENCES comparacion_corridas (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

const fechaONull = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);
const cortar = (s, n) => String(s ?? '').slice(0, n);

async function main() {
  const t0 = Date.now();
  // Lado Ministerio = los TRES listados juntos (la Intranet los da por dependencia y no se pisan):
  //   MINISTERIO.* (Hospital) + UPA4.* + UPA18.*  — los bajan los robots intranet_descarga_novedades*
  const dirMin = path.join(BASE_DIR, 'MINISTERIO');
  const hosp = excelMasNuevo(dirMin, /^MINISTERIO\./i) ?? excelMasNuevo(dirMin, /^(?!UPA\s*\d+\.)/i);
  if (!hosp) throw new Error(`No hay Excel del Hospital en ${dirMin}`);
  const mins = [hosp, excelMasNuevo(dirMin, /^UPA\s*4\./i), excelMasNuevo(dirMin, /^UPA\s*18\./i)].filter(Boolean);
  if (mins.length < 3) console.log('AVISO: falta el listado de alguna UPA: sus novedades van a salir como "solo SIAPE".');
  const min = { f: mins.map((m) => path.basename(m.f)).join(' + '), t: Math.min(...mins.map((m) => m.t)) };
  const sia = excelMasNuevo(path.join(BASE_DIR, 'SIAPE'));
  if (!sia) throw new Error(`No hay Excel en ${path.join(BASE_DIR, 'SIAPE')}`);
  for (const m of mins) console.log(`Ministerio: ${m.f} (${new Date(m.t).toLocaleString('es-AR', { hour12: false })})`);
  console.log(`SIAPE:      ${sia.f} (${new Date(sia.t).toLocaleString('es-AR', { hour12: false })})`);

  const cn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'personalv5', dateStrings: true,
  });
  try {
    const [mrows] = await cn.query(
      'SELECT novedad_siape, novedad_ministerio FROM mapeo_novedades WHERE activo = 1 ORDER BY novedad_ministerio, id');
    const mapeo = {};
    for (const r of mrows) {
      const arr = (mapeo[r.novedad_ministerio] ||= []);
      if (!arr.includes(r.novedad_siape)) arr.push(r.novedad_siape);
    }
    // Reglas solo de la 2.0 (no van a la tabla mapeo_novedades porque la usa lo viejo):
    // los ausentes se comparan contra el art. 28 del Ministerio. Los carga el robot de
    // ausentes 2.0 (cargar_ausentes_intranet_v2.py), no la carga de novedades 2.0.
    for (const [min, siaps] of Object.entries(REGLAS_SOLO_V2)) {
      const arr = (mapeo[min] ||= []);
      for (const s of siaps) if (!arr.includes(s)) arr.push(s);
    }

    const ministerio = mins.flatMap((m) => parseExcelMinisterio(m.f));
    const siapExcel = parseExcelSiape(sia.f);
    const examenesAuto = examenesAutomaticos(siapExcel);
    const siap = [...siapExcel, ...examenesAuto];
    const resultado = comparar(ministerio, siap, mapeo);

    const mN = normMapeo(mapeo);
    const cuenta = (e) => resultado.filter((r) => r.estado === e).length;
    const resumen = {
      total_ministerio: ministerio.length,
      total_siap_con_novedad: siap.filter((s) => {
        const nn = normNovedad(s.novedad);
        return Object.values(mN).some((a) => a.includes(nn)) || Object.keys(mN).includes(nn);
      }).length,
      coincidentes: cuenta('COINCIDENTE'),
      rango_distinto: cuenta('RANGO_DISTINTO'),
      no_coincidentes: cuenta('NO COINCIDENTE'),
      solo_siap: cuenta('SOLO_SIAP'),
      examenes_automaticos: examenesAuto.length,
      examenes_automaticos_a_cargar: resultado.filter((r) => r.estado === 'SOLO_SIAP' && r.motivo === MOTIVO_EXAMEN_AUTO).length,
    };

    await crearTablas(cn);
    await cn.beginTransaction();
    const [ins] = await cn.query(
      `INSERT INTO comparacion_corridas
        (archivo_ministerio, ministerio_modificado, archivo_siape, siape_modificado, total_ministerio,
         total_siap_con_novedad, coincidentes, rango_distinto, no_coincidentes, solo_siap,
         examenes_automaticos, examenes_automaticos_a_cargar, duracion_ms)
       VALUES (?, FROM_UNIXTIME(?), ?, FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [min.f, Math.floor(min.t / 1000), sia.f, Math.floor(sia.t / 1000), resumen.total_ministerio,
        resumen.total_siap_con_novedad, resumen.coincidentes, resumen.rango_distinto, resumen.no_coincidentes,
        resumen.solo_siap, resumen.examenes_automaticos, resumen.examenes_automaticos_a_cargar, Date.now() - t0]);
    const corrida = ins.insertId;
    const filas = resultado.map((r) => [
      corrida, r.estado, cortar(r.motivo, 80), cortar(r.dependencia, 20), cortar(r.ley, 120),
      cortar(r.legajo, 20), cortar(r.dni, 12), cortar(r.nombre, 160),
      r.novedad_ministerio === '—' ? '' : cortar(r.novedad_ministerio, 160),
      fechaONull(r.fecha_desde_min), fechaONull(r.fecha_hasta_min),
      r.novedad_siap === '—' ? '' : cortar(r.novedad_siap, 160),
      fechaONull(r.fecha_desde_siap), fechaONull(r.fecha_hasta_siap), cortar(r.justificado_siap, 10),
    ]);
    for (let i = 0; i < filas.length; i += 500) {
      await cn.query(
        `INSERT INTO comparacion_novedades
          (corrida_id, estado, motivo, dependencia, ley, legajo, dni, nombre, novedad_ministerio,
           desde_ministerio, hasta_ministerio, novedad_siap, desde_siap, hasta_siap, justificado_siap)
         VALUES ?`, [filas.slice(i, i + 500)]);
    }
    await cn.commit();

    const porDep = {};
    for (const r of resultado) {
      if (r.estado !== 'SOLO_SIAP' || r.motivo === 'BECARIO_NO_APLICA') continue;
      porDep[r.dependencia] = (porDep[r.dependencia] || 0) + 1;
    }
    console.log(`Corrida ${corrida}: ${resultado.length} filas · coincidentes ${resumen.coincidentes} · rango distinto ${resumen.rango_distinto} · no coincidentes ${resumen.no_coincidentes} · solo SIAP ${resumen.solo_siap}`);
    console.log(`Solo SIAP a cargar por dependencia: ${Object.entries(porDep).map(([d, n]) => `${d} ${n}`).join(' · ') || 'ninguna'}`);
    console.log(JSON.stringify({ ok: true, corrida, filas: resultado.length, ...resumen }));
  } catch (e) {
    try { await cn.rollback(); } catch { /* sin transaccion abierta */ }
    throw e;
  } finally {
    await cn.end();
  }
}

export { parseExcelMinisterio, parseExcelSiape, examenesAutomaticos, comparar };

// solo corre si se ejecuta directo (se puede importar para probar contra el comparador viejo)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`ERROR: ${e?.message || e}`);
    console.log(JSON.stringify({ ok: false, error: e?.message || String(e) }));
    process.exitCode = 1;
  });
}
