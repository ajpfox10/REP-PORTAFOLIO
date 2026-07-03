// src/routes/licencias.routes.ts
// GET /api/v1/licencias/resumen
//   Lee Tiempo Acumulado.xls (EXCEL_ASISTENCIA_DIR) y devuelve los días
//   pendientes de licencia por agente, enriquecidos con servicio activo desde DB.
//
// Query params:
//   servicio_id  → filtra por servicio activo del agente
//   dni          → filtra por DNI exacto
//   q            → filtra por apellido (substring, case-insensitive)
//   page / limit → paginación (default limit=50)

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { QueryTypes, Sequelize } from 'sequelize';

// biome-ignore lint/suspicious/noExplicitAny: SheetJS tiene tipado dinámico
let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

// ── Cache en memoria ─────────────────────────────────────────────────────────
interface CacheEntry {
  ts: number;
  rows: AcumRow[];
}

interface AcumRow {
  apellido_nombre: string;
  tipo_doc: string;
  dni: number;
  legajo: string;
  tipo_licencia: string;
  cant_dias: number;
  pasa: string;
  estructura_servicio: string;
  regimen: string;
  planta: string;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

function leerTiempoAcumulado(dir: string): AcumRow[] {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.rows;

  const xlsPath = path.join(dir, 'Tiempo Acumulado.xls');
  if (!fs.existsSync(xlsPath)) throw new Error(`Archivo no encontrado: ${xlsPath}`);

  const wb = XLSX.readFile(xlsPath, { cellDates: true, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // header:1 → array de arrays
  // Fila 0: título, 1-2: vacías, 3: separador, 4: headers, 5+: datos
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  const rows: AcumRow[] = [];

  for (let i = 5; i < raw.length; i++) {
    const r = raw[i] as unknown[];
    if (!r || r[2] == null) continue;

    const dniRaw = String(r[2] ?? '').replace(/\D/g, '');
    const dni = parseInt(dniRaw);
    if (!dni) continue;

    const cantDias = typeof r[5] === 'number' ? r[5] : parseFloat(String(r[5] ?? '')) || 0;
    const tipoLic  = String(r[4] ?? '').trim();
    if (!tipoLic || tipoLic === 'Tipo de Licencia') continue;

    rows.push({
      apellido_nombre:     String(r[0]  ?? '').trim(),
      tipo_doc:            String(r[1]  ?? '').trim(),
      dni,
      legajo:              String(r[3]  ?? '').trim(),
      tipo_licencia:       tipoLic,
      cant_dias:           cantDias,
      pasa:                String(r[6]  ?? '').trim(),
      estructura_servicio: String(r[7]  ?? '').trim(),
      regimen:             String(r[16] ?? '').trim(),
      planta:              String(r[17] ?? '').trim(),
    });
  }

  cache = { ts: Date.now(), rows };
  return rows;
}

export function buildLicenciasRouter(sequelize: Sequelize) {
  const router = Router();

  // Reclamos de certificados/licencias medicas cargados como documentos.
  // Solo admin completo: contiene documentacion medica sensible.
  router.get(
    '/reclamos-medicos',
    requirePermission('crud:*:*'),
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit ?? '50')) || 50));
        const page = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
        const offset = (page - 1) * limit;

        const where: string[] = [
          'a.deleted_at IS NULL',
          `(
            (
              LOWER(CONCAT_WS(' ', a.nombre, a.tipo, a.descripcion_archivo, a.nombre_archivo_original)) LIKE '%reclamo%'
              AND LOWER(CONCAT_WS(' ', a.nombre, a.tipo, a.descripcion_archivo, a.nombre_archivo_original))
                  REGEXP '(^|[^a-z0-9])cm([^a-z0-9]|$)'
            )
            OR LOWER(CONCAT_WS(' ', a.nombre, a.tipo, a.descripcion_archivo, a.nombre_archivo_original))
                REGEXP 'reclamo.*(certificado|licencia).*med|(certificado|licencia).*med.*reclamo'
          )`,
        ];
        const replacements: Record<string, unknown> = { limit, offset };

        const dni = String(req.query.dni ?? '').replace(/\D/g, '');
        if (dni) {
          where.push('a.dni = :dni');
          replacements.dni = Number(dni);
        }

        const q = String(req.query.q ?? '').trim();
        if (q) {
          where.push(`(
            p.apellido LIKE :q OR p.nombre LIKE :q OR
            CONCAT_WS(' ', p.apellido, p.nombre) LIKE :q OR
            a.nombre LIKE :q OR a.nombre_archivo_original LIKE :q
          )`);
          replacements.q = `%${q}%`;
        }

        const mes = String(req.query.mes ?? '').trim();
        if (/^\d{4}-\d{2}$/.test(mes)) {
          where.push(`DATE_FORMAT(a.fecha, '%Y-%m') = :mes`);
          replacements.mes = mes;
        }

        const fechaDesde = String(req.query.fecha_desde ?? '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde)) {
          where.push('DATE(a.fecha) >= :fechaDesde');
          replacements.fechaDesde = fechaDesde;
        }

        const fechaHasta = String(req.query.fecha_hasta ?? '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) {
          where.push('DATE(a.fecha) <= :fechaHasta');
          replacements.fechaHasta = fechaHasta;
        }

        const cargadoPor = String(req.query.cargado_por ?? '').trim();
        if (/^\d+$/.test(cargadoPor)) {
          where.push('COALESCE(a.created_by, a.escaneado_por) = :cargadoPor');
          replacements.cargadoPor = Number(cargadoPor);
        }

        const whereSql = where.join('\n AND ');
        const baseFrom = `
          FROM tblarchivos a
          LEFT JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
          LEFT JOIN usuarios u ON u.id = COALESCE(a.created_by, a.escaneado_por)
                               AND u.deleted_at IS NULL
          WHERE ${whereSql}
        `;

        const [rows, countRows, uploaderRows, monthRows] = await Promise.all([
          sequelize.query(
            `SELECT
               a.id, a.dni, p.apellido, p.nombre,
               a.nombre AS documento_nombre, a.tipo, a.numero,
               a.fecha AS fecha_reclamo, a.descripcion_archivo,
               a.nombre_archivo_original, a.created_at AS fecha_carga,
               COALESCE(a.created_by, a.escaneado_por) AS cargado_por_id,
               COALESCE(u.nombre, u.email) AS cargado_por_nombre,
               u.email AS cargado_por_email
             ${baseFrom}
             ORDER BY a.fecha DESC, a.id DESC
             LIMIT :limit OFFSET :offset`,
            { replacements, type: QueryTypes.SELECT }
          ),
          sequelize.query(
            `SELECT COUNT(*) AS total ${baseFrom}`,
            { replacements, type: QueryTypes.SELECT }
          ),
          sequelize.query(
            `SELECT DISTINCT
               COALESCE(a.created_by, a.escaneado_por) AS id,
               COALESCE(u.nombre, u.email, CONCAT('Usuario #', COALESCE(a.created_by, a.escaneado_por))) AS nombre
             ${baseFrom}
             AND COALESCE(a.created_by, a.escaneado_por) IS NOT NULL
             ORDER BY nombre`,
            { replacements, type: QueryTypes.SELECT }
          ),
          sequelize.query(
            `SELECT DATE_FORMAT(a.fecha, '%Y-%m') AS mes, COUNT(*) AS total
             ${baseFrom}
             AND a.fecha IS NOT NULL
             GROUP BY DATE_FORMAT(a.fecha, '%Y-%m')
             ORDER BY mes DESC`,
            { replacements, type: QueryTypes.SELECT }
          ),
        ]);

        const total = Number((countRows as any[])[0]?.total ?? 0);
        return res.json({
          ok: true,
          data: rows,
          meta: {
            total,
            page,
            limit,
            pages: Math.max(1, Math.ceil(total / limit)),
            cargadores: uploaderRows,
            meses: monthRows,
          },
        });
      } catch (err: unknown) {
        logger.error({ msg: 'Error buscando reclamos medicos documentales', err });
        return res.status(500).json({ ok: false, error: 'Error buscando reclamos de licencias medicas' });
      }
    }
  );

  router.get(
    '/resumen',
    requirePermission('crud:*:*'),
    async (req: Request, res: Response) => {
      try {
        if (!XLSX) {
          return res.status(503).json({ ok: false, error: 'Módulo xlsx no disponible en el servidor' });
        }

        const dir = (env as any).EXCEL_ASISTENCIA_DIR as string;
        if (!dir) {
          return res.status(503).json({ ok: false, error: 'EXCEL_ASISTENCIA_DIR no configurado en .env' });
        }

        // ── 1. Leer Excel ────────────────────────────────────────────────────
        let acum: AcumRow[];
        try {
          acum = leerTiempoAcumulado(dir);
        } catch (e: any) {
          return res.status(404).json({ ok: false, error: e.message });
        }

        // ── 2. Filtros iniciales (dni, q/apellido) ───────────────────────────
        const filtroDni    = req.query.dni    ? parseInt(String(req.query.dni)) : null;
        const filtroQ      = req.query.q      ? String(req.query.q).toLowerCase().trim() : null;
        // estado: 'todos' | 'con_dias' (>0) | 'sin_dias' (=0)
        const filtroEstado = String(req.query.estado ?? 'todos');

        let filtered = acum;
        if (filtroDni) filtered = filtered.filter(r => r.dni === filtroDni);
        if (filtroQ)   filtered = filtered.filter(r =>
          r.apellido_nombre.toLowerCase().includes(filtroQ)
        );
        if (filtroEstado === 'con_dias')  filtered = filtered.filter(r => r.cant_dias > 0);
        if (filtroEstado === 'sin_dias')  filtered = filtered.filter(r => r.cant_dias === 0);

        // ── 3. Enriquecer con servicio activo desde DB ───────────────────────
        const dnis = [...new Set(filtered.map(r => r.dni))];

        let servicioMap = new Map<number, { servicio_id: number; servicio_nombre: string }>();

        if (dnis.length > 0) {
          const [dbRows] = await sequelize.query(
            `SELECT a.dni, s.id AS servicio_id, s.nombre AS servicio_nombre
             FROM agentes a
             LEFT JOIN agentes_servicios ags ON ags.id = (
               SELECT id FROM agentes_servicios
               WHERE dni = a.dni AND deleted_at IS NULL AND fecha_hasta IS NULL
               ORDER BY id DESC LIMIT 1
             )
             LEFT JOIN servicios s ON s.id = ags.servicio_id
             WHERE a.dni IN (:dnis) AND a.deleted_at IS NULL`,
            { replacements: { dnis } }
          );

          for (const ag of dbRows as any[]) {
            if (!servicioMap.has(ag.dni)) {
              servicioMap.set(ag.dni, {
                servicio_id:     ag.servicio_id   ?? 0,
                servicio_nombre: ag.servicio_nombre ?? '—',
              });
            }
          }
        }

        // ── 4. Filtro por servicio_id ────────────────────────────────────────
        const filtroServicio = req.query.servicio_id ? parseInt(String(req.query.servicio_id)) : null;

        let enriched = filtered.map(r => {
          const srv = servicioMap.get(r.dni);
          return {
            ...r,
            servicio_id:     srv?.servicio_id     ?? null,
            servicio_nombre: srv?.servicio_nombre ?? '—',
          };
        });

        if (filtroServicio) {
          enriched = enriched.filter(r => r.servicio_id === filtroServicio);
        }

        // ── 5. Ordenar: apellido ASC ─────────────────────────────────────────
        enriched.sort((a, b) => a.apellido_nombre.localeCompare(b.apellido_nombre, 'es'));

        // ── 6. Paginación ────────────────────────────────────────────────────
        const total = enriched.length;
        const limit = Math.min(200, parseInt(String(req.query.limit ?? '50')) || 50);
        const page  = Math.max(1,   parseInt(String(req.query.page  ?? '1'))  || 1);
        const slice = enriched.slice((page - 1) * limit, page * limit);

        return res.json({
          ok: true,
          data: slice,
          meta: { total, page, limit, pages: Math.ceil(total / limit) },
        });

      } catch (err: unknown) {
        logger.error({ msg: 'Error licencias resumen', err });
        return res.status(500).json({ ok: false, error: 'Error procesando licencias pendientes' });
      }
    }
  );

  // Invalida el cache (útil al reemplazar el archivo)
  router.post(
    '/invalidar-cache',
    requirePermission('crud:*:*'),
    (_req: Request, res: Response) => {
      cache = null;
      return res.json({ ok: true, message: 'Cache invalidado' });
    }
  );

  return router;
}
