// src/services/licenciasMedicasControl.ts
// Control de cómo se cargaron en el Ministerio las licencias médicas del SIAPE
// (pestaña "Licencias médicas" del Comparador). Solo lectura:
//   - qué es: LICENCIAS_MEDICAS.xlsx (export SIAPE, robot siape_licencias_medicas) + nombre del CIE (cie_codigos)
//   - cómo debería cargarse: mapeo_novedades (regla por CIE, si no la general de carga)
//   - cómo se cargó: ministerio_novedades_anual (códigos reales, por DNI y fechas que se pisan)
//     + novedades_carga_intranet (estado del robot de carga, si la tomó)

import fs from 'fs';
import path from 'path';
import { Sequelize, QueryTypes } from 'sequelize';
import { normCie } from './mapeoNovedades';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

// relleno que el SIAPE pone en CODIGO_OMS cuando no hay diagnóstico real
const CIE_RELLENO = new Set(['', '-', '999', '66666666', '88888888', '99999999']);

export type EstadoLic = 'OK' | 'DISTINTO' | 'NO_CARGADA' | 'SIN_CIE';

export interface FilaLicencia {
  dni: string;
  nombre: string;
  legajo: string;
  novedad_siape: string;
  resolucion: string;
  desde: string;
  hasta: string;
  dias: number | null;
  cie: string;
  cie_relleno: boolean;
  diagnostico_siape: string;
  diagnostico_cie: string | null;
  esperado: string;           // novedad Ministerio que corresponde ('' si no hay regla)
  esperado_codigo: string;    // '01', '1RO', ...
  por_cie: boolean;           // el esperado sale de una regla por CIE
  cargado_codigos: string[];  // códigos que figuran en el Ministerio en esas fechas
  cargado: string[];          // textos de esas novedades
  dependencia: string;
  robot_estado: string | null;
  robot_detalle: string | null;
  estado: EstadoLic;
}

const norm = (s: any) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const codigoDe = (novMin: string) => String(novMin || '').split('-')[0].trim().toUpperCase();

function aIso(v: any): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : '';
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

// el Excel tarda ~3 s en leerse: se cachea por fecha de modificación
let cache: { archivo: string; mtime: number; filas: any[] } | null = null;

function leerExcel(dir: string): { archivo: string | null; filas: any[]; actualizado: string | null } {
  if (!XLSX) throw new Error('Falta dependencia "xlsx"');
  const nombre = fs.existsSync(dir)
    ? fs.readdirSync(dir).find(f => /\.xls[xm]?$/i.test(f) && !f.startsWith('~$') && /licencias?_?medicas/i.test(f))
    : undefined;
  if (!nombre) return { archivo: null, filas: [], actualizado: null };
  const fp = path.join(dir, nombre);
  const st = fs.statSync(fp);
  if (!cache || cache.archivo !== fp || cache.mtime !== st.mtimeMs) {
    const wb = XLSX.readFile(fp, { cellDates: false });
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
    cache = { archivo: fp, mtime: st.mtimeMs, filas };
  }
  return { archivo: nombre, filas: cache.filas, actualizado: st.mtime.toISOString() };
}

export async function controlLicenciasMedicas(
  sequelize: Sequelize,
  dir: string,
  desde: string,
  hasta: string,
) {
  const { archivo, filas, actualizado } = leerExcel(dir);

  // reglas de carga: (novedad SIAPE, CIE) → novedad Ministerio; CIE '' = la general
  const reglas = await sequelize.query<{ novedad_siape: string; codigo_cie: string; novedad_ministerio: string }>(
    `SELECT novedad_siape, codigo_cie, novedad_ministerio FROM mapeo_novedades
      WHERE activo = 1 AND usar_para_cargar = 1`,
    { type: QueryTypes.SELECT },
  );
  const regla = new Map<string, string>();
  const novConCie = new Set<string>(); // novedades SIAPE donde el CIE decide (ENFERMEDAD)
  for (const r of reglas) {
    regla.set(`${norm(r.novedad_siape)}|${(r.codigo_cie || '').toUpperCase()}`, r.novedad_ministerio);
    if (r.codigo_cie) novConCie.add(norm(r.novedad_siape));
  }

  // licencias del período (se pisan con [desde, hasta])
  const lic = filas
    .map(r => ({
      dni: String(r.NRO_DOCUMENTO ?? '').replace(/\D/g, ''),
      nombre: `${String(r.APELLIDO ?? '').trim()}, ${String(r.NOMBRE ?? '').trim()}`,
      legajo: String(r.LEGAJO ?? '').trim(),
      novedad_siape: String(r.NOVEDAD ?? '').trim(),
      resolucion: String(r.RESOLUCION ?? '').trim(),
      desde: aIso(r.FECHA_DESDE),
      hasta: aIso(r.FECHA_HASTA) || aIso(r.FECHA_DESDE),
      dias: Number(r.DIAS) || null,
      cieRaw: String(r.CODIGO_OMS ?? '').trim(),
      diagnostico_siape: String(r.DIAGNOSTICO ?? '').trim(),
    }))
    .filter(l => l.dni && l.desde && l.desde <= hasta && l.hasta >= desde);

  // el export del SIAPE trae licencias de toda la región (~9000 DNI): solo las de nuestros agentes
  const candidatos = [...new Set(lic.map(l => l.dni))];
  const propios = new Set<string>();
  if (candidatos.length) {
    const rows = await sequelize.query<{ dni: string }>(
      `SELECT DISTINCT CAST(dni AS CHAR) AS dni FROM agentes WHERE deleted_at IS NULL AND dni IN (:candidatos)`,
      { type: QueryTypes.SELECT, replacements: { candidatos } },
    );
    for (const r of rows) propios.add(String(r.dni));
  }
  const totalRegion = lic.length;
  for (let i = lic.length - 1; i >= 0; i--) if (!propios.has(lic[i].dni)) lic.splice(i, 1);
  const dnis = [...propios];
  const cies = [...new Set(lic.map(l => normCie(l.cieRaw)).filter(c => !CIE_RELLENO.has(c)))];

  const nombresCie = new Map<string, string>();
  if (cies.length) {
    const rows = await sequelize.query<{ codigo: string; descripcion: string }>(
      `SELECT codigo, descripcion FROM cie_codigos WHERE codigo IN (:cies)`,
      { type: QueryTypes.SELECT, replacements: { cies } },
    ).catch(() => []);
    for (const r of rows) nombresCie.set(r.codigo, r.descripcion);
  }

  type Min = { dni: string; dependencia: string; novedad: string; codigo: string; d: string; h: string };
  const minPorDni = new Map<string, Min[]>();
  type Rob = { dni: string; novedad_siap: string; desde: string; hasta: string; estado: string; label_intranet: string | null; detalle: string | null };
  const robPorDni = new Map<string, Rob[]>();
  if (dnis.length) {
    const mins = await sequelize.query<Min>(
      `SELECT CAST(dni AS CHAR) AS dni, dependencia, novedad, codigo,
              DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS d, DATE_FORMAT(COALESCE(fecha_hasta, fecha_desde), '%Y-%m-%d') AS h
         FROM ministerio_novedades_anual
        WHERE dni IN (:dnis) AND fecha_desde <= :hasta AND COALESCE(fecha_hasta, fecha_desde) >= :desde`,
      { type: QueryTypes.SELECT, replacements: { dnis, desde, hasta } },
    );
    for (const m of mins) (minPorDni.get(m.dni) ?? minPorDni.set(m.dni, []).get(m.dni)!).push(m);

    const robs = await sequelize.query<Rob>(
      `SELECT CAST(dni AS CHAR) AS dni, novedad_siap, DATE_FORMAT(desde, '%Y-%m-%d') AS desde,
              DATE_FORMAT(COALESCE(hasta, desde), '%Y-%m-%d') AS hasta, estado, label_intranet, detalle
         FROM novedades_carga_intranet
        WHERE dni IN (:dnis) AND desde <= :hasta AND COALESCE(hasta, desde) >= :desde
        ORDER BY actualizado_en DESC`,
      { type: QueryTypes.SELECT, replacements: { dnis, desde, hasta } },
    ).catch(() => [] as Rob[]);
    for (const r of robs) (robPorDni.get(r.dni) ?? robPorDni.set(r.dni, []).get(r.dni)!).push(r);
  }

  const out: FilaLicencia[] = lic.map(l => {
    const cie = normCie(l.cieRaw);
    const relleno = CIE_RELLENO.has(cie);
    const nov = norm(l.novedad_siape);
    const porCie = !relleno ? regla.get(`${nov}|${cie}`) : undefined;
    const esperado = porCie ?? regla.get(`${nov}|`) ?? '';
    const pisan = (minPorDni.get(l.dni) ?? []).filter(m => m.d <= l.hasta && m.h >= l.desde);
    const codigos = [...new Set(pisan.map(m => (m.codigo || codigoDe(m.novedad)).toUpperCase()))];
    const rob = (robPorDni.get(l.dni) ?? []).find(r => norm(r.novedad_siap) === nov && r.desde <= l.hasta && r.hasta >= l.desde);
    const esperadoCod = codigoDe(esperado);
    let estado: EstadoLic;
    if (!pisan.length) estado = 'NO_CARGADA';
    else if (relleno && novConCie.has(nov)) estado = 'SIN_CIE'; // el CIE decide y vino de relleno
    else if (esperadoCod && codigos.includes(esperadoCod)) estado = 'OK';
    else estado = 'DISTINTO';
    return {
      dni: l.dni,
      nombre: l.nombre,
      legajo: l.legajo,
      novedad_siape: l.novedad_siape,
      resolucion: l.resolucion,
      desde: l.desde,
      hasta: l.hasta,
      dias: l.dias,
      cie: relleno ? l.cieRaw : cie,
      cie_relleno: relleno,
      diagnostico_siape: l.diagnostico_siape,
      diagnostico_cie: relleno ? null : nombresCie.get(cie) ?? null,
      esperado,
      esperado_codigo: esperadoCod,
      por_cie: !!porCie,
      cargado_codigos: codigos,
      cargado: [...new Set(pisan.map(m => m.novedad))],
      dependencia: [...new Set(pisan.map(m => m.dependencia))].join(', '),
      robot_estado: rob?.estado ?? null,
      robot_detalle: rob ? rob.label_intranet || rob.detalle || null : null,
      estado,
    };
  });

  out.sort((a, b) => (a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : a.nombre.localeCompare(b.nombre)));

  const [ultimaMin] = await sequelize.query<{ f: string | null }>(
    `SELECT DATE_FORMAT(MAX(descargado_en), '%Y-%m-%d %H:%i') AS f FROM ministerio_novedades_anual`,
    { type: QueryTypes.SELECT },
  );
  return {
    archivo, actualizado, ministerio_descargado: ultimaMin?.f ?? null, desde, hasta,
    total_region: totalRegion, filas: out,
  };
}
