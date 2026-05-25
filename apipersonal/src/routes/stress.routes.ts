// src/routes/stress.routes.ts
// Alertas de stress post-vacacional
//
// GET /stress/alertas
//   → Agentes que:
//     1. Tienen Cant. Días = 0 en "Tiempo Acumulado.xls" (usaron toda su vacación)
//     2. NO tienen ANUAL COMPLEMENTARIA cargada en historial (stress aún no aplicado)
//     3. Pasaron >= 40 días desde su último día de ANUAL en historial
//
// Retorna: dni, nombre, ultimo_dia_vacaciones, dias_transcurridos, ley, servicio, dias_stress

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { Sequelize } from 'sequelize';

// biome-ignore lint/suspicious/noExplicitAny: SheetJS tiene tipado dinámico
let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

const HOY_DATE = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();
const UMBRAL_DIAS = 40;

// ley_id que corresponden a 12 días de stress fijos:
// 4=LEY 10471 Guardia, 5=LEY 10471 Planta, 6-10=Programas Beca, 11=RESIDENTES, 12-13=Beca Radicacion/Vacunacion
const LEY_12_DIAS = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

function calcularStress(leyId: number | null, fechaIngreso: Date | null): number | null {
  if (!leyId) return null;
  if (LEY_12_DIAS.has(leyId)) return 12;
  // Ley 10.430 (ids 1 y 3) u otras → proporcional por antigüedad
  if (fechaIngreso) {
    const fi = new Date(fechaIngreso);
    // Fecha placeholder 1111-11-11 → antigüedad desconocida
    if (fi.getFullYear() < 1900) return null;
    const anios = (HOY_DATE.getTime() - fi.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (anios < 5)  return 6;
    if (anios < 10) return 9;
    if (anios < 20) return 12;
    return 14;
  }
  return null;
}

function parseDateStr(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();
  // Formato DD-MON-YY (ej: 23-FEB-26, 08-MAR-26)
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const months: Record<string, number> = {
      JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5,
      JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11,
    };
    const mon = months[m[2].toUpperCase()];
    if (mon === undefined) return null;
    let year = parseInt(m[3]);
    if (year < 100) year += 2000;
    return new Date(year, mon, parseInt(m[1]));
  }
  // Fallback ISO
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function buildStressRouter(sequelize: Sequelize) {
  const router = Router();

  // GET /api/v1/stress/alertas
  router.get(
    '/alertas',
    requirePermission('crud:*:*'),
    async (_req: Request, res: Response) => {
      try {
        if (!XLSX) {
          return res.status(503).json({ ok: false, error: 'Módulo xlsx no disponible en el servidor' });
        }

        const dir = (env as any).EXCEL_ASISTENCIA_DIR as string;
        if (!dir) {
          return res.status(503).json({ ok: false, error: 'EXCEL_ASISTENCIA_DIR no configurado en .env' });
        }

        // ── 1. Tiempo Acumulado.xls ──────────────────────────────────────────
        const xlsPath = path.join(dir, 'Tiempo Acumulado.xls');
        if (!fs.existsSync(xlsPath)) {
          return res.status(404).json({ ok: false, error: `Archivo no encontrado: ${xlsPath}` });
        }

        const wbAcum = XLSX.readFile(xlsPath, { cellDates: true, raw: true });
        const wsAcum = wbAcum.Sheets[wbAcum.SheetNames[0]];
        // header:1 → array de arrays; fila 0=título, 4=headers, 5+=datos
        const rowsAcum: unknown[][] = XLSX.utils.sheet_to_json(wsAcum, { header: 1, raw: true });

        // Acumular días por DNI (columna 2=Numero/DNI, columna 5=Cant. Días)
        const dniDias = new Map<number, number>();
        const dniNombreAcum = new Map<number, string>();

        for (let i = 5; i < rowsAcum.length; i++) {
          const row = rowsAcum[i] as unknown[];
          if (!row || row[2] == null) continue;
          const dni = parseInt(String(row[2]).replace(/\D/g, ''));
          if (!dni) continue;
          const dias = typeof row[5] === 'number' ? row[5] : parseFloat(String(row[5] ?? '0')) || 0;
          dniDias.set(dni, (dniDias.get(dni) ?? 0) + dias);
          if (!dniNombreAcum.has(dni)) {
            dniNombreAcum.set(dni, String(row[0] ?? '').trim());
          }
        }

        // Solo los que tienen 0 días restantes
        const dniAtZero = new Set<number>(
          [...dniDias.entries()].filter(([, total]) => total === 0).map(([dni]) => dni)
        );

        if (dniAtZero.size === 0) {
          return res.json({ ok: true, data: [], total: 0 });
        }

        // ── 2. historial.xlsx ────────────────────────────────────────────────
        const xlsxPath = path.join(dir, 'historial.xlsx');
        if (!fs.existsSync(xlsxPath)) {
          return res.status(404).json({ ok: false, error: `Archivo no encontrado: ${xlsxPath}` });
        }

        const wbHist = XLSX.readFile(xlsxPath, { cellDates: true, raw: false });
        const wsHist = wbHist.Sheets[wbHist.SheetNames[0]];
        // Fila 0 = headers; fila 1+ = datos
        // Col 4=NRO_DOCUMENTO, 11=NOVEDAD, 12=FECHA_DESDE, 13=FECHA_HASTA
        const rowsHist: unknown[][] = XLSX.utils.sheet_to_json(wsHist, { header: 1, raw: false });

        const tieneComplementaria = new Set<number>();
        const ultimoAnual = new Map<number, Date>();
        const dniNombreHist = new Map<number, string>();

        for (let i = 1; i < rowsHist.length; i++) {
          const row = rowsHist[i] as unknown[];
          if (!row || row[4] == null) continue;
          const dni = parseInt(String(row[4]).replace(/\D/g, ''));
          if (!dni || !dniAtZero.has(dni)) continue;

          const novedad = String(row[11] ?? '').trim().toUpperCase();
          const fechaHasta = parseDateStr(row[13]);

          if (!dniNombreHist.has(dni)) {
            dniNombreHist.set(dni, `${row[1] ?? ''} ${row[2] ?? ''}`.trim());
          }

          if (novedad.includes('ANUAL COMPLEMENTARIA')) {
            tieneComplementaria.add(dni);
          } else if (novedad === 'ANUAL' && fechaHasta) {
            const cur = ultimoAnual.get(dni);
            if (!cur || fechaHasta > cur) ultimoAnual.set(dni, fechaHasta);
          }
        }

        // ── 3. Filtrar elegibles ─────────────────────────────────────────────
        const elegibles: { dni: number; nombre: string; ultimoAnual: Date; diasTranscurridos: number }[] = [];

        for (const dni of dniAtZero) {
          if (tieneComplementaria.has(dni)) continue;
          const ultimo = ultimoAnual.get(dni);
          if (!ultimo) continue;
          const dias = Math.floor((HOY_DATE.getTime() - ultimo.getTime()) / (24 * 3600 * 1000));
          if (dias < UMBRAL_DIAS) continue;
          elegibles.push({
            dni,
            nombre: dniNombreHist.get(dni) || dniNombreAcum.get(dni) || '',
            ultimoAnual: ultimo,
            diasTranscurridos: dias,
          });
        }

        if (elegibles.length === 0) {
          return res.json({ ok: true, data: [], total: 0 });
        }

        // ── 4. Enriquecer con datos de la DB ─────────────────────────────────
        const dnis = elegibles.map(e => e.dni);
        const [agRows] = await sequelize.query(
          `SELECT a.dni, l.id AS ley_id, l.nombre AS ley, s.nombre AS servicio, a.fecha_ingreso
           FROM agentes a
           LEFT JOIN ley l ON a.ley_id = l.id
           LEFT JOIN agentes_servicios ags_cur ON ags_cur.id = (SELECT id FROM agentes_servicios WHERE dni = a.dni AND deleted_at IS NULL AND fecha_hasta IS NULL ORDER BY id DESC LIMIT 1)
           LEFT JOIN servicios s ON s.id = ags_cur.servicio_id
           WHERE a.dni IN (:dnis) AND a.deleted_at IS NULL
           ORDER BY a.id DESC`,
          { replacements: { dnis } }
        );

        // Si un DNI tiene múltiples filas en agentes, queda el primero (más reciente)
        const agMap = new Map<number, Record<string, unknown>>();
        for (const ag of agRows as Record<string, unknown>[]) {
          if (!agMap.has(ag.dni as number)) agMap.set(ag.dni as number, ag);
        }

        // ── 5. Construir respuesta ────────────────────────────────────────────
        const data = elegibles
          .map(e => {
            const ag = agMap.get(e.dni);
            const leyId    = (ag?.ley_id as number | null)  ?? null;
            const leyNombre = (ag?.ley as string | null)    ?? '—';
            const servicio  = (ag?.servicio as string | null) ?? '—';
            const fechaIngreso = ag?.fecha_ingreso ? new Date(ag.fecha_ingreso as string) : null;

            return {
              dni:                   e.dni,
              nombre:                e.nombre,
              ultimo_dia_vacaciones: e.ultimoAnual.toISOString().slice(0, 10),
              dias_transcurridos:    e.diasTranscurridos,
              ley:                   leyNombre,
              servicio,
              dias_stress:           calcularStress(leyId, fechaIngreso),
            };
          })
          .sort((a, b) => b.dias_transcurridos - a.dias_transcurridos);

        return res.json({ ok: true, data, total: data.length });

      } catch (err: unknown) {
        logger.error({ msg: 'Error stress alertas', err });
        return res.status(500).json({ ok: false, error: 'Error procesando alertas de stress' });
      }
    }
  );

  return router;
}
