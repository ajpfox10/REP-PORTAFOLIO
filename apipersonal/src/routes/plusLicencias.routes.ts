// src/routes/plusLicencias.routes.ts
// GET  /api/v1/plus-licencias               → tabla de licencias con cómo cuentan para el plus de Guardia y de Planta
// PUT  /api/v1/plus-licencias/:codigo        → editar la clasificación (solo crud:*:*)
// GET  /api/v1/plus-licencias/no-cobran?fuente=archivo|anual&anio=AAAA[&mes=MM] → quién no cobra / cobra reducido
//
// Clasificación en la tabla licencias_plus_norma (mig 089). Normas: guardia Dto 398/89 art.2 + 374/08 +
// 14/2026 art.4; planta Dto 375/08 + 4204/89 art.2 + Acta 28/03/2022.
// Criterios del usuario (20/10/2026): lo que la norma no nombra DESCUENTA, y la mezcla de dos o más
// licencias distintas en el mes también es causal de descuento.
// Novedades: MINISTERIO/UPA4/UPA18.xls que baja el robot de la Intranet, o la tabla ministerio_novedades_anual. Días de guardia: HORARIO_GUARDIA.xlsx
// (export SIAPE "Horario Guardia Salud", EXCEL_ASISTENCIA_DIR): solo cuentan las licencias que caen en
// el día de la semana en que el agente hace guardia.

import path from 'path';
import fs from 'fs';
import { Router, Request, Response } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { requireAny } from '../middlewares/rbacCrud';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

type Clase = 'EXCEPTUADA' | 'ENFERMEDAD' | 'NEUTRA' | 'DESCUENTA';
const CLASES: Clase[] = ['EXCEPTUADA', 'ENFERMEDAD', 'NEUTRA', 'DESCUENTA'];

// getUTCDay(): 0 = domingo
const DIAS_EXCEL = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];

// Para la "mezcla de licencias" se toman como una sola las que son la misma licencia con otro código.
function familia(codigo: string, clase: Clase): string {
  if (clase === 'ENFERMEDAD') return 'ENFERMEDAD';
  if (['08', '29', '291'].includes(codigo)) return 'ANUAL';
  if (['81', '810', '811', '812', '93'].includes(codigo)) return 'DENEGADA';
  return codigo;
}

interface LicRow {
  codigo: string; novedad: string; guardia: Clase; planta: Clase;
  norma_guardia: string | null; norma_planta: string | null; observacion: string | null;
  en_catalogo: number; sin_clasificar: number; usos_10471: number;
}

async function cargarLicencias(sequelize: Sequelize): Promise<LicRow[]> {
  return sequelize.query<LicRow>(
    `SELECT t.codigo, t.novedad, t.guardia, t.planta, t.norma_guardia, t.norma_planta, t.observacion,
            (c.codigo IS NOT NULL) AS en_catalogo, 0 AS sin_clasificar,
            (SELECT COUNT(*) FROM ministerio_novedades_anual m
              WHERE m.codigo COLLATE utf8mb4_unicode_ci = t.codigo) AS usos_10471
       FROM licencias_plus_norma t
       LEFT JOIN ministerio_codigos c ON c.codigo COLLATE utf8mb4_unicode_ci = t.codigo
     UNION ALL
     SELECT c.codigo, c.novedad, 'DESCUENTA', 'DESCUENTA', NULL, NULL, 'Código nuevo: sin clasificar',
            1, 1,
            (SELECT COUNT(*) FROM ministerio_novedades_anual m WHERE m.codigo COLLATE utf8mb4_unicode_ci = c.codigo)
       FROM ministerio_codigos c
      WHERE NOT EXISTS (SELECT 1 FROM licencias_plus_norma t WHERE t.codigo = c.codigo COLLATE utf8mb4_unicode_ci)
      ORDER BY codigo`,
    { type: QueryTypes.SELECT },
  );
}

/** DNI → días de la semana (0-6) en que hace guardia, según HORARIO_GUARDIA.xlsx. */
function leerHorarioGuardia(): { mapa: Map<number, number[]>; archivo: string | null; error?: string } {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  const file = dir ? path.join(dir, 'HORARIO_GUARDIA.xlsx') : null;
  const mapa = new Map<number, number[]>();
  if (!XLSX || !file || !fs.existsSync(file)) return { mapa, archivo: null, error: 'No se encontró HORARIO_GUARDIA.xlsx' };
  try {
    const wb = XLSX.readFile(file);
    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });
    for (const r of rows) {
      const dni = Number(String(r.NRO_DOCUMENTO ?? '').replace(/\D/g, ''));
      if (!dni) continue;
      const dias: number[] = [];
      DIAS_EXCEL.forEach((d, i) => {
        const e = String(r[`${d}_ENTRADA`] ?? '').trim();
        if (e && e !== '-') dias.push(i);
      });
      if (dias.length) mapa.set(dni, dias);
    }
    return { mapa, archivo: 'HORARIO_GUARDIA.xlsx' };
  } catch (e: any) {
    logger.warn({ msg: 'plus-licencias: error leyendo HORARIO_GUARDIA', error: e?.message });
    return { mapa, archivo: null, error: e?.message };
  }
}

const utc = (d: Date | string) => {
  // 'AAAA-MM-DD' se toma literal: new Date() lo leería como UTC y en hora local daría el día anterior.
  const m = typeof d === 'string' ? d.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const x = new Date(d);
  return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
};

export function buildPlusLicenciasRouter(sequelize?: Sequelize): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexion a DB');
      return res.json({ ok: true, licencias: await cargarLicencias(sequelize) });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // Novedades del Mapeo de novedades (lado Ministerio, 'CODIGO-TEXTO') que todavía no están en la tabla.
  router.get('/opciones', async (_req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexion a DB');
      const rows = await sequelize.query<{ novedad: string; siape: string | null }>(
        `SELECT m.novedad_ministerio AS novedad,
                GROUP_CONCAT(DISTINCT m.novedad_siape ORDER BY m.novedad_siape SEPARATOR ' · ') AS siape
           FROM mapeo_novedades m
          WHERE m.activo = 1 AND m.novedad_ministerio LIKE '%-%'
          GROUP BY m.novedad_ministerio
          ORDER BY m.novedad_ministerio`,
        { type: QueryTypes.SELECT },
      );
      const ya = new Set((await cargarLicencias(sequelize)).filter(l => !l.sin_clasificar).map(l => l.codigo));
      const opciones = rows
        .map(r => ({ codigo: r.novedad.split('-')[0].trim().slice(0, 10), novedad: r.novedad, siape: r.siape }))
        .filter(o => o.codigo && !ya.has(o.codigo));
      return res.json({ ok: true, opciones });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.put('/:codigo', requireAny(['crud:*:*']), async (req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexion a DB');
      const codigo = String(req.params.codigo || '').trim().slice(0, 10);
      const { guardia, planta, observacion, novedad } = req.body ?? {};
      if (!CLASES.includes(guardia) || !CLASES.includes(planta)) {
        return res.status(400).json({ ok: false, error: 'Clasificación inválida' });
      }
      const userId = (req as any).auth?.principalId ?? (req as any).user?.id ?? null;
      await sequelize.query(
        `INSERT INTO licencias_plus_norma (codigo, novedad, guardia, planta, observacion, updated_by)
         VALUES (:codigo, :novedad, :guardia, :planta, :obs, :userId)
         ON DUPLICATE KEY UPDATE guardia = VALUES(guardia), planta = VALUES(planta),
                                 observacion = VALUES(observacion), updated_by = VALUES(updated_by)`,
        {
          type: QueryTypes.INSERT,
          replacements: {
            codigo, novedad: String(novedad || codigo).slice(0, 150), guardia, planta,
            obs: observacion ? String(observacion).slice(0, 255) : null, userId,
          },
        },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // GET /no-cobran?fuente=archivo|anual&anio=AAAA[&mes=MM]
  //   fuente=archivo → MINISTERIO.xls / UPA4.xls / UPA18.xls que baja el robot de la Intranet (período en curso)
  //   fuente=anual   → tabla ministerio_novedades_anual (descarga anual, enero del año pasado en adelante)
  //   Sin mes = todo el año: una fila por agente y mes.
  router.get('/no-cobran', async (req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexion a DB');
      const fuente = String(req.query.fuente || 'archivo') === 'anual' ? 'anual' : 'archivo';
      const anio = Number(req.query.anio);
      const mesNum = req.query.mes ? Number(req.query.mes) : null;
      if (!anio || anio < 2000 || anio > 2100) return res.status(400).json({ ok: false, error: 'anio=AAAA' });
      if (mesNum !== null && (mesNum < 1 || mesNum > 12)) return res.status(400).json({ ok: false, error: 'mes=1..12' });
      const meses = mesNum ? [mesNum] : Array.from({ length: 12 }, (_, i) => i + 1);

      const lic = await cargarLicencias(sequelize);
      const clase = new Map(lic.map(l => [l.codigo, l]));
      const agentes = await sequelize.query<{ dni: number; nombre: string; ley: string; profesion: string | null }>(
        `SELECT a.dni, TRIM(CONCAT(COALESCE(p.apellido,''),' ',COALESCE(p.nombre,''))) AS nombre, l.nombre AS ley, oc.nombre AS profesion
           FROM agentes a
           JOIN ley l ON l.id = a.ley_id
           LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
           LEFT JOIN personal p ON p.dni = a.dni
          WHERE a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO' AND l.nombre LIKE '%10471%'`,
        { type: QueryTypes.SELECT },
      );

      let novs: Nov[] = [];
      let archivos: Fuente[] = [];
      if (fuente === 'archivo') {
        const r = leerArchivosMinisterio();
        novs = r.novs;
        archivos = r.archivos;
      } else {
        novs = (await sequelize.query<any>(
          `SELECT dni, codigo, novedad, DATE_FORMAT(fecha_desde,'%Y-%m-%d') AS d,
                  DATE_FORMAT(COALESCE(fecha_hasta, fecha_desde),'%Y-%m-%d') AS h
             FROM ministerio_novedades_anual
            WHERE fecha_desde <= :hasta AND COALESCE(fecha_hasta, fecha_desde) >= :desde`,
          { type: QueryTypes.SELECT, replacements: { desde: `${anio}-01-01`, hasta: `${anio}-12-31` } },
        )).map((n: any) => ({ dni: Number(n.dni), codigo: String(n.codigo), novedad: n.novedad, d: n.d, h: n.h }));
        const [rango] = await sequelize.query<any>(
          `SELECT COUNT(*) AS n, DATE_FORMAT(MIN(fecha_desde),'%Y-%m-%d') AS desde, DATE_FORMAT(MAX(fecha_desde),'%Y-%m-%d') AS hasta,
                  DATE_FORMAT(MAX(descargado_en),'%d/%m/%Y %H:%i') AS descargado
             FROM ministerio_novedades_anual`,
          { type: QueryTypes.SELECT },
        );
        archivos = [{
          archivo: `Descarga anual (bajada ${rango?.descargado ?? '—'})`,
          filas: Number(rango?.n ?? 0), desde: rango?.desde ?? null, hasta: rango?.hasta ?? null,
        }];
      }
      const porDni = new Map<number, Nov[]>();
      for (const n of novs) {
        if (!porDni.has(n.dni)) porDni.set(n.dni, []);
        porDni.get(n.dni)!.push(n);
      }
      const hg = leerHorarioGuardia();

      const filas: any[] = [];
      for (const m of meses) filas.push(...evaluarMes(agentes, porDni, clase, hg.mapa, anio, m));
      filas.sort((x, z) => x.mes.localeCompare(z.mes) || (x.pct ?? 101) - (z.pct ?? 101) || x.nombre.localeCompare(z.nombre, 'es'));

      return res.json({
        ok: true,
        fuente,
        anio,
        mes: mesNum,
        archivos,
        // archivo: el período que cubren los tres a la vez (el inicio más tardío); anual: desde el principio.
        cubre_desde: fuente === 'archivo'
          ? (archivos.map(a => a.desde).filter(Boolean).sort().at(-1) ?? null)
          : (archivos[0]?.desde ?? null),
        archivo_horario: hg.archivo,
        aviso_horario: hg.error ?? null,
        total_agentes: agentes.length,
        filas,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  return router;
}

interface Nov { dni: number; codigo: string; novedad: string; d: string; h: string }
interface Fuente { archivo: string; filas: number; desde: string | null; hasta: string | null; error?: string }

const ARCHIVOS_MINISTERIO = ['MINISTERIO.xls', 'UPA4.xls', 'UPA18.xls'];

/** Serial de Excel → 'AAAA-MM-DD'. Se redondea: el .xls de Novedades Registradas puede traer fracciones
 *  (.874…) y truncar da un día menos (ver nota de exports del Ministerio). */
function serialAFecha(v: any): string | null {
  const n = Number(v);
  if (!n || !XLSX) return null;
  const d = XLSX.SSF.parse_date_code(Math.round(n));
  return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
}

/** Novedades Registradas que baja el robot de la Intranet: EXCEL_ASISTENCIA_DIR/MINISTERIO/*.xls */
function leerArchivosMinisterio(): { novs: Nov[]; archivos: Fuente[] } {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  const novs: Nov[] = [];
  const archivos: Fuente[] = [];
  for (const nombre of ARCHIVOS_MINISTERIO) {
    const file = dir ? path.join(dir, 'MINISTERIO', nombre) : '';
    if (!XLSX || !file || !fs.existsSync(file)) {
      archivos.push({ archivo: nombre, filas: 0, desde: null, hasta: null, error: 'no encontrado' });
      continue;
    }
    try {
      const wb = XLSX.readFile(file);
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: '' });
      let min: string | null = null;
      let max: string | null = null;
      let n = 0;
      const porMes = new Map<string, number>();
      for (const r of rows) {
        const dni = Number(String(r['Nro Documento'] ?? '').replace(/\D/g, ''));
        const nov = String(r['Novedad'] ?? '').trim();
        const d = serialAFecha(r['Fecha Desde']);
        const h = serialAFecha(r['Fecha Hasta']) ?? d;
        if (!dni || !nov || !d || !h) continue;
        novs.push({ dni, codigo: nov.split('-')[0].trim(), novedad: nov, d, h });
        n++;
        porMes.set(d.slice(0, 7), (porMes.get(d.slice(0, 7)) ?? 0) + 1);
        if (!min || d < min) min = d;
        if (!max || d > max) max = d;
      }
      const bajado = fs.statSync(file).mtime.toLocaleString('es-AR');
      // El reporte trae el período en curso más alguna licencia larga que empezó antes: el primer mes
      // "real" es el primero con al menos el 10% de las filas del mes más cargado.
      const tope = Math.max(0, ...porMes.values()) * 0.1;
      const efectivo = [...porMes.entries()].sort(([x], [z]) => x.localeCompare(z)).find(([, c]) => c >= tope)?.[0];
      archivos.push({ archivo: `${nombre} (bajado ${bajado})`, filas: n, desde: efectivo ? `${efectivo}-01` : min, hasta: max });
    } catch (e: any) {
      archivos.push({ archivo: nombre, filas: 0, desde: null, hasta: null, error: e?.message });
    }
  }
  return { novs, archivos };
}

function evaluarMes(
  agentes: { dni: number; nombre: string; ley: string; profesion: string | null }[],
  porDni: Map<number, Nov[]>,
  clase: Map<string, LicRow>,
  horario: Map<number, number[]>,
  anio: number,
  mes: number,
) {
  const ini = Date.UTC(anio, mes - 1, 1);
  const fin = Date.UTC(anio, mes, 0);
  const etiqueta = `${anio}-${String(mes).padStart(2, '0')}`;
  const filas: any[] = [];
  for (const a of agentes) {
    const esGuardia = /guardia/i.test(a.ley);
    const diasGuardia = horario.get(a.dni) ?? null;
    // código → set de fechas (en guardia: solo las que caen en día de guardia)
    const porCodigo = new Map<string, { novedad: string; clase: Clase; fechas: Set<string> }>();
    for (const n of porDni.get(a.dni) ?? []) {
      const cod = String(n.codigo);
      const info = clase.get(cod);
      const cl: Clase = info ? (esGuardia ? info.guardia : info.planta) : 'DESCUENTA';
      if (cl === 'NEUTRA') continue;
      const d0 = Math.max(utc(n.d), ini);
      const d1 = Math.min(utc(n.h), fin);
      for (let t = d0; t <= d1; t += 864e5) {
        if (esGuardia && diasGuardia && !diasGuardia.includes(new Date(t).getUTCDay())) continue;
        if (!porCodigo.has(cod)) porCodigo.set(cod, { novedad: n.novedad, clase: cl, fechas: new Set() });
        porCodigo.get(cod)!.fechas.add(new Date(t).toISOString().slice(0, 10));
      }
    }
    if (!porCodigo.size) continue;

    const contar = (c: Clase) => {
      const s = new Set<string>();
      for (const v of porCodigo.values()) if (v.clase === c) v.fechas.forEach(f => s.add(f));
      return s.size;
    };
    const enf = contar('ENFERMEDAD');
    const desc = contar('DESCUENTA');
    const familias = new Set<string>();
    for (const [cod, v] of porCodigo) {
      if (!esGuardia && cod === '33') continue; // planta: donación de sangre no cuenta aun junto con otras
      familias.add(familia(cod, v.clase));
    }
    const mezcla = familias.size >= 2;
    const motivos: string[] = [];
    let pct: number | null = 1;

    if (esGuardia) {
      if (!diasGuardia) motivos.push('Sin día de guardia en HORARIO_GUARDIA: se contaron días corridos');
      if (enf >= 2) {
        const f = enf === 2 ? 0.75 : enf === 3 ? 0.5 : enf === 4 ? 0.25 : 0;
        pct *= f;
        motivos.push(`Enfermedad ${enf} guardias → ${f * 100}%`);
      }
      const causales = desc + (mezcla ? 1 : 0);
      if (desc) motivos.push(`${desc} guardia(s) con licencia que descuenta`);
      if (mezcla) motivos.push(`Mezcla de ${familias.size} licencias distintas`);
      if (causales === 1) pct *= 0.5;
      if (causales >= 2) pct = 0;
      if (!diasGuardia && pct < 1) pct = null; // no se puede afirmar sin el día de guardia
    } else {
      if (enf > 6) {
        const f = enf <= 12 ? 0.75 : enf <= 18 ? 0.5 : enf <= 24 ? 0.25 : 0;
        pct *= f;
        motivos.push(`Enfermedad ${enf} días → ${f * 100}%`);
      }
      if (mezcla) { pct = 0; motivos.push(`Mezcla de ${familias.size} licencias distintas`); }
      else if (desc === 1) motivos.push('1 inasistencia tolerada (Dto 375/08 inc. m)');
      if (desc >= 2) { pct = 0; motivos.push(`${desc} días con licencia que descuenta`); }
    }

    filas.push({
      mes: etiqueta,
      dni: a.dni,
      nombre: a.nombre,
      profesion: a.profesion || null,
      tipo: esGuardia ? 'GUARDIA' : 'PLANTA',
      pct: pct === null ? null : Math.round(pct * 100),
      motivos,
      sin_horario: esGuardia && !diasGuardia,
      licencias: [...porCodigo.entries()].map(([codigo, v]) => ({
        codigo, novedad: v.novedad, clase: v.clase, cantidad: v.fechas.size,
        fechas: [...v.fechas].sort(),
      })),
    });
  }
  return filas;
}
