// src/routes/sinSalida.routes.ts
// Agentes sin fichaje de salida — cruzado con horarios y SIAP
//
// FLUJO:
//  POST /sin-salida  → por fecha exacta (YYYY-MM-DD) o por período mensual (YYYY-MM)
//
// Body JSON:
//   fecha         YYYY-MM-DD  (un día exacto)
//   periodo       YYYY-MM     (mes completo — expande todos los días laborables)
//   horariosFiles string[]    (auto-detecta archivos con "horario" en el nombre)
//   siapFiles     string[]    (auto-detecta archivos con "siap"    en el nombre)
//
// Estado por fila:
//   SIN_SALIDA  → tiene entrada pero sin salida en el fichaje
//   SIN_FICHAJE → sin ningún registro, y sin novedad SIAP que lo justifique
//   JUSTIFICADO → sin fichaje pero tiene novedad SIAP que cubre esa fecha
//   CON_SALIDA  → tiene entrada y salida (todo OK)
//
// Notas:
//   - Múltiples archivos de horarios y SIAP son combinados (uno por UPA)
//   - La UPA del agente se resuelve desde las columnas E5/E6 del SIAP
//   - Usa la misma DB biométrica (fichero_config.json) que el módulo Fichero

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let ExcelJS: any;
try { ExcelJS = require('exceljs'); } catch { ExcelJS = null; }

// ── Helpers de texto ─────────────────────────────────────────────────────────
function normHeader(s: any): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellToText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'object' && Array.isArray((v as any).richText)) {
    return String((v as any).richText.map((x: any) => x.text).join('')).trim();
  }
  return String(v).trim();
}

function normDni(v: any): string {
  return String(v ?? '').replace(/[^0-9]/g, '').trim();
}

// ── Helpers de fecha ─────────────────────────────────────────────────────────
function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const months: Record<string, number> = {
      JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
      ENE:0,ABR:3,AGO:7,SET:8,DIC:11,
    };
    const m1 = val.match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})$/i);
    if (m1) {
      const y  = parseInt(m1[3]) + (m1[3].length === 2 ? 2000 : 0);
      const mo = months[m1[2].toUpperCase()] ?? 0;
      return new Date(Date.UTC(y, mo, parseInt(m1[1])));
    }
    const iso = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2]-1, +iso[3]));
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const toUTCMidnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const dateToStr = (d: Date | null): string => d ? d.toISOString().slice(0, 10) : '';

// ── Directorio de Excel ───────────────────────────────────────────────────────
function getDir(): string {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!dir) throw new Error('Falta EXCEL_ASISTENCIA_DIR en .env');
  return dir;
}

function listExcelFiles(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.xlsx') || f.toLowerCase().endsWith('.xltx'))
    .map(f => ({ name: f, fullPath: path.join(dir, f) }));
}

// ── Tipos internos ───────────────────────────────────────────────────────────
type HorarioDia = {
  lunes: boolean; martes: boolean; miercoles: boolean;
  jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean;
};

// Umbral de corte para reasignar salidas al día anterior:
//   agentes normales → salidas hasta las 06:00 del día siguiente
//   GUARDIA (24hs)   → salidas hasta las 14:00 del día siguiente
const CUTOFF_NORMAL  = '06:00';
const CUTOFF_GUARDIA = '14:00';

const DOW_KEYS  = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'] as const;
const DOW_LABELS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

// ── Parser horarios ──────────────────────────────────────────────────────────
// Lee horarios y también PLANTA_DE_REVISTA para identificar agentes de guardia.
async function parseHorariosFile(fp: string): Promise<Record<string, { nombre: string; esGuardia: boolean; horario: HorarioDia }>> {
  const result: Record<string, { nombre: string; esGuardia: boolean; horario: HorarioDia }> = {};
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const ws = wb.worksheets[0];
  if (!ws) return result;

  const hdr: Record<string, number> = {};
  ws.getRow(1).eachCell((c: any, col: number) => {
    const v = normHeader(c?.value ?? '');
    if (v) hdr[v] = col;
  });

  const colDni      = hdr['nro_documento'] ?? hdr['nro documento'] ?? hdr['documento'] ?? hdr['dni'] ?? 4;
  const colNomFull  = hdr['apellido y nombres'] ?? hdr['apellido y nombre'] ?? hdr['apellido_nombre'] ?? hdr['apellido_nombre'] ?? 0;
  const colApellido = hdr['apellido'] ?? 0;
  const colNomFirst = hdr['nombre'] ?? 0;
  // APELLIDO_NOMBRE es la columna 2 según el análisis del archivo real
  const colNombreCol2 = hdr['apellido_nombre'] ?? hdr['apellido nombre'] ?? 2;
  const colLun      = hdr['lunes_controlable']     ?? 23;
  const colMar      = hdr['martes_controlable']    ?? 24;
  const colMie      = hdr['miercoles_controlable'] ?? 25;
  const colJue      = hdr['jueves_controlable']    ?? 26;
  const colVie      = hdr['viernes_controlable']   ?? 27;
  const colSab      = hdr['sabado_controlable']    ?? 28;
  const colDom      = hdr['domingo_controlable']   ?? 29;
  // PLANTA_DE_REVISTA → columna 32 según análisis del archivo real
  const colPlantaRevista = hdr['planta_de_revista'] ?? hdr['planta de revista'] ?? 32;
  const isSI = (v: any) => String(v ?? '').toUpperCase().trim() === 'SI';

  ws.eachRow((r: any, rn: number) => {
    if (rn === 1) return;
    const dni = normDni(r.getCell(colDni)?.value);
    if (!dni) return;

    let nombre = '';
    if (colNomFull) {
      nombre = cellToText(r.getCell(colNomFull)?.value);
    } else if (colApellido && colNomFirst) {
      nombre = [
        cellToText(r.getCell(colApellido)?.value),
        cellToText(r.getCell(colNomFirst)?.value),
      ].filter(Boolean).join(', ');
    } else if (colNombreCol2) {
      nombre = cellToText(r.getCell(colNombreCol2)?.value);
    }

    // GUARDIA = PLANTA_DE_REVISTA contiene "GUARDIA"
    const plantaRevista = cellToText(r.getCell(colPlantaRevista)?.value).toUpperCase();
    const esGuardia     = plantaRevista.includes('GUARDIA');

    result[dni] = {
      nombre,
      esGuardia,
      horario: {
        lunes:     isSI(r.getCell(colLun)?.value),
        martes:    isSI(r.getCell(colMar)?.value),
        miercoles: isSI(r.getCell(colMie)?.value),
        jueves:    isSI(r.getCell(colJue)?.value),
        viernes:   isSI(r.getCell(colVie)?.value),
        sabado:    isSI(r.getCell(colSab)?.value),
        domingo:   isSI(r.getCell(colDom)?.value),
      },
    };
  });
  return result;
}

// ── Parser SIAP (extracto mínimo: dni, nombre, upa, novedad, desde, hasta) ───
function resolveUpa(e5raw: string, e6raw: string): string {
  const norm = (s: string) =>
    String(s ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const e6 = norm(e6raw);
  const e5 = norm(e5raw);
  const inE6 = e6.match(/UPA\s*(\d+)/) ?? e6.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (inE6) return `UPA ${inE6[1]}`;
  const inE5 = e5.match(/UPA\s*(\d+)/) ?? e5.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (inE5) return `UPA ${inE5[1]}`;
  return 'HOSPITAL';
}

async function parseSiapFile(fp: string): Promise<Array<{
  dni: string; nombre: string; upa: string;
  novedad: string; desde: Date | null; hasta: Date | null;
}>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const hdr: Record<string, number> = {};
  ws.getRow(1).eachCell((c: any, col: number) => {
    const v = normHeader(c?.value ?? '');
    if (v) hdr[v] = col;
  });

  const colDni      = hdr['nro_documento'] ?? hdr['nro documento'] ?? hdr['dni'] ?? hdr['documento'] ?? 5;
  const colApellido = hdr['apellido'] ?? 2;
  const colNomFirst = hdr['nombre'] ?? 3;
  const colNomFull  = hdr['apellido y nombres'] ?? hdr['apellido y nombre'] ?? 0;
  const colNovedad  = hdr['novedad'] ?? hdr['novedad siap'] ?? 12;
  const colDesde    = hdr['fecha_desde'] ?? hdr['fecha desde'] ?? hdr['desde'] ?? 13;
  const colHasta    = hdr['fecha_hasta'] ?? hdr['fecha hasta'] ?? hdr['hasta'] ?? 14;
  const colE5       = hdr['e5'] ?? 21;
  const colE6       = hdr['e6'] ?? 22;

  const rows: any[] = [];
  ws.eachRow((r: any, rn: number) => {
    if (rn === 1) return;
    const dni = normDni(r.getCell(colDni)?.value);
    if (!dni) return;
    let nombre: string;
    if (colNomFull) {
      nombre = cellToText(r.getCell(colNomFull)?.value);
    } else {
      nombre = [
        cellToText(r.getCell(colApellido)?.value),
        cellToText(r.getCell(colNomFirst)?.value),
      ].filter(Boolean).join(', ');
    }
    const e5  = cellToText(r.getCell(colE5)?.value);
    const e6  = cellToText(r.getCell(colE6)?.value);
    const upa = resolveUpa(e5, e6);
    rows.push({
      dni,
      nombre,
      upa,
      novedad: cellToText(r.getCell(colNovedad)?.value),
      desde:   parseDate(r.getCell(colDesde)?.value),
      hasta:   parseDate(r.getCell(colHasta)?.value),
    });
  });
  return rows;
}

// ── Router ───────────────────────────────────────────────────────────────────
export function buildSinSalidaRouter() {
  const router = Router();

  // POST /sin-salida
  router.post('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) {
      return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs en el backend' });
    }
    try {
      const dir   = getDir();
      const files = listExcelFiles(dir);

      // ── Determinar rango de fechas ────────────────────────────────────────
      // Acepta "fecha" (YYYY-MM-DD) o "periodo" (YYYY-MM).
      // Si vienen los dos, periodo tiene prioridad.
      const periodoStr = String(req.body?.periodo ?? '').trim();
      const fechaStr   = String(req.body?.fecha   ?? '').trim();

      let fechas: string[] = [];

      if (/^\d{4}-\d{2}$/.test(periodoStr)) {
        // Expandir todos los días del mes
        const [y, m] = periodoStr.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        for (let d = 1; d <= daysInMonth; d++) {
          fechas.push(`${periodoStr}-${String(d).padStart(2, '0')}`);
        }
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
        fechas = [fechaStr];
      } else {
        return res.status(400).json({ ok: false, error: 'Falta "fecha" (YYYY-MM-DD) o "periodo" (YYYY-MM)' });
      }

      const rangoMin = fechas[0];
      const rangoMax = fechas[fechas.length - 1];

      // ── Archivos horarios ─────────────────────────────────────────────────
      let horariosFileNames: string[] = Array.isArray(req.body?.horariosFiles) && req.body.horariosFiles.length > 0
        ? req.body.horariosFiles
        : files.filter(f => f.name.toLowerCase().includes('horario')).map(f => f.name);

      // ── Archivos SIAP ─────────────────────────────────────────────────────
      let siapFileNames: string[] = Array.isArray(req.body?.siapFiles) && req.body.siapFiles.length > 0
        ? req.body.siapFiles
        : files.filter(f => f.name.toLowerCase().includes('siap')).map(f => f.name);

      // ── 1. Leer horarios (todos los archivos, merge por DNI) ──────────────
      const horariosMap: Record<string, { nombre: string; esGuardia: boolean; horario: HorarioDia }> = {};
      for (const fileName of horariosFileNames) {
        const fp = path.join(dir, fileName);
        if (!fs.existsSync(fp)) continue;
        try {
          const parcial = await parseHorariosFile(fp);
          Object.assign(horariosMap, parcial);
        } catch (e: any) {
          logger.warn({ msg: 'sin-salida: error leyendo horarios', file: fileName, error: e?.message });
        }
      }

      if (Object.keys(horariosMap).length === 0) {
        return res.status(400).json({ ok: false, error: 'No se encontraron datos en los archivos de horarios' });
      }

      // ── 2. Leer SIAP (todos los archivos, merge por DNI) ──────────────────
      const siapDniMap: Record<string, {
        nombre: string;
        upa: string;
        novedades: Array<{ novedad: string; desde: Date; hasta: Date }>;
      }> = {};

      for (const fileName of siapFileNames) {
        const fp = path.join(dir, fileName);
        if (!fs.existsSync(fp)) continue;
        try {
          const rows = await parseSiapFile(fp);
          for (const r of rows) {
            if (!siapDniMap[r.dni]) {
              siapDniMap[r.dni] = { nombre: r.nombre, upa: r.upa, novedades: [] };
            }
            if (r.nombre && !siapDniMap[r.dni].nombre) siapDniMap[r.dni].nombre = r.nombre;
            if (r.upa)  siapDniMap[r.dni].upa = r.upa;
            if (r.desde && r.hasta) {
              siapDniMap[r.dni].novedades.push({
                novedad: r.novedad,
                desde:   r.desde,
                hasta:   r.hasta,
              });
            }
          }
        } catch (e: any) {
          logger.warn({ msg: 'sin-salida: error leyendo SIAP', file: fileName, error: e?.message });
        }
      }

      // Helper: novedad SIAP para un DNI en una fecha dada
      const getSiapNovedad = (dni: string, fechaIso: string): string => {
        const info = siapDniMap[dni];
        if (!info) return '';
        const dt = toUTCMidnight(new Date(fechaIso + 'T00:00:00Z'));
        const matches = info.novedades.filter(e =>
          toUTCMidnight(e.desde) <= dt && dt <= toUTCMidnight(e.hasta),
        );
        return [...new Set(matches.map(e => e.novedad).filter(Boolean))].join(' / ');
      };

      // ── 3. Expandir: agente × fecha donde debe trabajar ───────────────────
      // Para cada fecha del rango, filtrar quién tiene ese día como controlable
      type ExpandedRow = { dni: string; nombre: string; upa: string; esGuardia: boolean; fecha: string; diaSemana: string };
      const expanded: ExpandedRow[] = [];

      for (const fechaIso of fechas) {
        const dt  = new Date(fechaIso + 'T00:00:00Z');
        const dow = dt.getUTCDay();
        const dowKey = DOW_KEYS[dow];
        const diaSemana = DOW_LABELS[dow];

        for (const [dni, info] of Object.entries(horariosMap)) {
          if (!info.horario[dowKey]) continue; // no controlable ese día
          const upa    = siapDniMap[dni]?.upa    ?? 'SIN UPA';
          const nombre = siapDniMap[dni]?.nombre || info.nombre || '';
          expanded.push({ dni, nombre, upa, esGuardia: info.esGuardia, fecha: fechaIso, diaSemana });
        }
      }

      if (expanded.length === 0) {
        const emptyMeta = { total: 0, sinSalida: 0, sinFichaje: 0, justificados: 0, conSalida: 0, sinBiometrico: false, dbError: null };
        return res.json({ ok: true, data: [], meta: emptyMeta });
      }

      // ── 4. Consultar DB biométrica (una sola query para el rango completo) ─
      // fichajesMap[dni][fechaISO] = { entrada, salida }
      type FichajeInfo = { entrada: string | null; salida: string | null };
      const fichajesMap: Record<string, Record<string, FichajeInfo>> = {};
      let dbError: string | null = null;

      const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
      if (fs.existsSync(cfgPath)) {
        try {
          const cfg  = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          const conn = await mysql.createConnection({
            host:           cfg.mysqlHost || '127.0.0.1',
            port:           cfg.mysqlPort || 3306,
            user:           cfg.mysqlUser || 'root',
            password:       cfg.mysqlPass || '',
            database:       cfg.mysqlDb   || 'adms_db',
            connectTimeout: 10_000,
            dateStrings:    true,
          });

          const allDnis = [...new Set(expanded.map(r => r.dni))];
          // Mapa rápido DNI → esGuardia para usar al procesar registros
          const guardiaDnis = new Set(expanded.filter(r => r.esGuardia).map(r => r.dni));

          // Extender el rango hasta las 14:00 del día siguiente al rangoMax
          // para capturar salidas de turno nocturno / guardia 24hs
          const rangoMaxPlusOneDate = new Date(rangoMax + 'T00:00:00Z');
          rangoMaxPlusOneDate.setUTCDate(rangoMaxPlusOneDate.getUTCDate() + 1);
          const rangoMaxPlusOne = rangoMaxPlusOneDate.toISOString().slice(0, 10);

          const ph      = allDnis.map(() => '?').join(',');
          const [dbRows] = await conn.query<RowDataPacket[]>(
            `SELECT ui.badgenumber, ci.checktime, ci.checktype
               FROM checkinout ci
               INNER JOIN userinfo ui ON ci.userid = ui.userid
               WHERE ui.badgenumber IN (${ph})
                 AND ci.checktime >= ? AND ci.checktime <= ?
               ORDER BY ci.checktime ASC`,
            [...allDnis, `${rangoMin} 00:00:00`, `${rangoMaxPlusOne} 14:00:00`],
          );
          await conn.end();

          for (const r of dbRows) {
            const dniR  = normDni(String(r.badgenumber));
            const cts   = String(r.checktime);
            let   fecha = cts.slice(0, 10);
            const hora  = cts.slice(11, 16);
            const tipo  = String(r.checktype);

            // Para salidas (checktype=1): si caen de madrugada del día siguiente,
            // reasignarlas al día anterior (turno nocturno / guardia 24hs).
            //   - Agentes normales : salidas hasta las 06:00 del día siguiente
            //   - Agentes GUARDIA  : salidas hasta las 14:00 del día siguiente
            if (tipo === '1') {
              const cutoff = guardiaDnis.has(dniR) ? CUTOFF_GUARDIA : CUTOFF_NORMAL;
              if (hora <= cutoff) {
                const d = new Date(fecha + 'T00:00:00Z');
                d.setUTCDate(d.getUTCDate() - 1);
                fecha = d.toISOString().slice(0, 10);
              }
            }

            if (!fichajesMap[dniR]) fichajesMap[dniR] = {};
            if (!fichajesMap[dniR][fecha]) fichajesMap[dniR][fecha] = { entrada: null, salida: null };
            if (tipo === '0') {
              if (!fichajesMap[dniR][fecha].entrada || hora < fichajesMap[dniR][fecha].entrada!)
                fichajesMap[dniR][fecha].entrada = hora;
            } else {
              if (!fichajesMap[dniR][fecha].salida || hora > fichajesMap[dniR][fecha].salida!)
                fichajesMap[dniR][fecha].salida = hora;
            }
          }
        } catch (e: any) {
          dbError = e?.message ?? 'Error al consultar DB biométrica';
          logger.warn({ msg: 'sin-salida: error DB biométrica', error: dbError });
        }
      } else {
        dbError = 'fichero_config.json no encontrado — configura la conexión en el módulo Fichero';
      }

      // ── 5. Construir resultado ─────────────────────────────────────────────
      const ORDEN: Record<string, number> = { SIN_SALIDA: 0, SIN_FICHAJE: 1, JUSTIFICADO: 2, CON_SALIDA: 3 };

      const data = expanded.map(row => {
        const fich      = fichajesMap[row.dni]?.[row.fecha];
        const novSiap   = getSiapNovedad(row.dni, row.fecha);

        let estado: string;
        if (fich?.entrada && fich?.salida)  estado = 'CON_SALIDA';
        else if (fich?.entrada)             estado = 'SIN_SALIDA';
        else if (novSiap)                   estado = 'JUSTIFICADO';
        else                                estado = 'SIN_FICHAJE';

        return {
          dni:        row.dni,
          nombre:     row.nombre,
          upa:        row.upa,
          esGuardia:  row.esGuardia,
          fecha:      row.fecha,
          diaSemana:  row.diaSemana,
          entrada:    fich?.entrada ?? null,
          salida:     fich?.salida  ?? null,
          novedadSiap: novSiap,
          estado,
        };
      });

      // Ordenar: estado (SIN_SALIDA primero) → nombre → fecha
      data.sort((a, b) => {
        const eo = (ORDEN[a.estado] ?? 99) - (ORDEN[b.estado] ?? 99);
        if (eo !== 0) return eo;
        const no = a.nombre.localeCompare(b.nombre);
        if (no !== 0) return no;
        return a.fecha.localeCompare(b.fecha);
      });

      return res.json({
        ok: true,
        data,
        meta: {
          total:        data.length,
          sinSalida:    data.filter(r => r.estado === 'SIN_SALIDA').length,
          sinFichaje:   data.filter(r => r.estado === 'SIN_FICHAJE').length,
          justificados: data.filter(r => r.estado === 'JUSTIFICADO').length,
          conSalida:    data.filter(r => r.estado === 'CON_SALIDA').length,
          sinBiometrico: !!dbError,
          dbError,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al procesar' });
    }
  });

  return router;
}
