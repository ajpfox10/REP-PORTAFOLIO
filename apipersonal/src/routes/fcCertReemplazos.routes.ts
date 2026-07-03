// src/routes/fcCertReemplazos.routes.ts
// CRUD para FC - Certificación de Servicios - Reemplazo de Guardias
// Acceso: admin (crud:*:*) y user (crud:fc_cert_reemplazos:read/write)

import { Router, Request, Response } from 'express';
import { Sequelize } from 'sequelize';
import { requirePermission, requireAny } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'] as const;

const SECCIONES = ['FRANCOS_COMPENSATORIOS','CERTIFICACION_SERVICIOS','REEMPLAZOS_GUARDIA'] as const;

type Seccion = typeof SECCIONES[number];

function esSeccionValida(s: unknown): s is Seccion {
  return SECCIONES.includes(s as Seccion);
}

export function buildFcCertReemplazosRouter(sequelize: Sequelize) {
  const router = Router();

  const canRead  = requireAny(['crud:fc_cert_reemplazos:read', 'crud:*:*']);
  const canWrite = requireAny(['crud:fc_cert_reemplazos:create', 'crud:*:*']);
  const canUpdate = requireAny(['crud:fc_cert_reemplazos:update', 'crud:*:*']);
  const canDelete = requirePermission('crud:*:*');

  // GET /api/v1/fc-cert-reemplazos?anio=2025&seccion=REEMPLAZOS_GUARDIA
  router.get('/', canRead, async (req: Request, res: Response) => {
    try {
      const anio    = req.query.anio    ? parseInt(String(req.query.anio))    : null;
      const seccion = req.query.seccion ? String(req.query.seccion)           : null;
      const q       = req.query.q       ? String(req.query.q).toLowerCase()  : null;

      let where = 'WHERE deleted_at IS NULL';
      const replacements: Record<string, unknown> = {};

      if (anio) {
        where += ' AND anio = :anio';
        replacements.anio = anio;
      }
      if (seccion && esSeccionValida(seccion)) {
        where += ' AND seccion = :seccion';
        replacements.seccion = seccion;
      }
      if (q) {
        where += ' AND LOWER(agente) LIKE :q';
        replacements.q = `%${q}%`;
      }

      const [rows] = await sequelize.query(
        `SELECT id, anio, seccion, agente,
                enero, febrero, marzo, abril, mayo, junio, julio,
                agosto, septiembre, octubre, noviembre, diciembre,
                creado_por, created_at, updated_at
         FROM fc_cert_reemplazos
         ${where}
         ORDER BY seccion ASC, agente ASC`,
        { replacements }
      );

      return res.json({ ok: true, data: rows });
    } catch (err: unknown) {
      logger.error({ msg: 'Error fc_cert_reemplazos GET', err });
      return res.status(500).json({ ok: false, error: 'Error al obtener registros' });
    }
  });

  // GET /api/v1/fc-cert-reemplazos/:id
  router.get('/:id', canRead, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

      const [rows] = await sequelize.query(
        'SELECT * FROM fc_cert_reemplazos WHERE id = :id AND deleted_at IS NULL',
        { replacements: { id } }
      );

      const row = (rows as unknown[])[0];
      if (!row) return res.status(404).json({ ok: false, error: 'Registro no encontrado' });
      return res.json({ ok: true, data: row });
    } catch (err: unknown) {
      logger.error({ msg: 'Error fc_cert_reemplazos GET/:id', err });
      return res.status(500).json({ ok: false, error: 'Error al obtener registro' });
    }
  });

  // POST /api/v1/fc-cert-reemplazos
  router.post('/', canWrite, async (req: Request, res: Response) => {
    try {
      const { anio, seccion, agente, ...meses } = req.body as Record<string, unknown>;

      if (!anio || !seccion || !agente) {
        return res.status(400).json({ ok: false, error: 'anio, seccion y agente son requeridos' });
      }
      if (!esSeccionValida(seccion)) {
        return res.status(400).json({ ok: false, error: `seccion inválida. Valores: ${SECCIONES.join(', ')}` });
      }

      const mesesCols = MESES.map(m => `\`${m}\``).join(', ');
      const mesesVals = MESES.map(m => `:${m}`).join(', ');
      const mesesReplacements = Object.fromEntries(
        MESES.map(m => [m, typeof meses[m] === 'string' ? (meses[m] as string).trim() || null : null])
      );

      const [result] = await sequelize.query(
        `INSERT INTO fc_cert_reemplazos
           (anio, seccion, agente, ${mesesCols}, creado_por)
         VALUES
           (:anio, :seccion, :agente, ${mesesVals}, :creado_por)`,
        {
          replacements: {
            anio: parseInt(String(anio)),
            seccion,
            agente: String(agente).trim(),
            ...mesesReplacements,
            creado_por: (req as any).auth?.principalId ?? null,
          },
        }
      );

      const insertId = (result as { insertId?: number }).insertId ?? null;

      (res.locals as Record<string, unknown>).audit = {
        action: 'fc_cert_reemplazos_create',
        table_name: 'fc_cert_reemplazos',
        record_pk: insertId,
        request_json: req.body,
        response_json: { status: 201, id: insertId },
      };

      return res.status(201).json({ ok: true, data: { id: insertId } });
    } catch (err: unknown) {
      logger.error({ msg: 'Error fc_cert_reemplazos POST', err });
      return res.status(500).json({ ok: false, error: 'Error al crear registro' });
    }
  });

  // PUT /api/v1/fc-cert-reemplazos/:id
  router.put('/:id', canUpdate, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

      const { anio, seccion, agente, ...meses } = req.body as Record<string, unknown>;

      if (seccion && !esSeccionValida(seccion)) {
        return res.status(400).json({ ok: false, error: `seccion inválida. Valores: ${SECCIONES.join(', ')}` });
      }

      const setClauses: string[] = [];
      const replacements: Record<string, unknown> = { id };

      if (anio)    { setClauses.push('anio = :anio');       replacements.anio    = parseInt(String(anio)); }
      if (seccion) { setClauses.push('seccion = :seccion'); replacements.seccion = seccion; }
      if (agente)  { setClauses.push('agente = :agente');   replacements.agente  = String(agente).trim(); }

      for (const m of MESES) {
        if (m in meses) {
          setClauses.push(`\`${m}\` = :${m}`);
          replacements[m] = typeof meses[m] === 'string' ? (meses[m] as string).trim() || null : null;
        }
      }

      if (setClauses.length === 0) {
        return res.status(400).json({ ok: false, error: 'Sin campos a actualizar' });
      }

      setClauses.push('updated_at = CURRENT_TIMESTAMP');

      await sequelize.query(
        `UPDATE fc_cert_reemplazos SET ${setClauses.join(', ')} WHERE id = :id AND deleted_at IS NULL`,
        { replacements }
      );

      (res.locals as Record<string, unknown>).audit = {
        action: 'fc_cert_reemplazos_update',
        table_name: 'fc_cert_reemplazos',
        record_pk: id,
        request_json: req.body,
        response_json: { status: 200 },
      };

      return res.json({ ok: true });
    } catch (err: unknown) {
      logger.error({ msg: 'Error fc_cert_reemplazos PUT', err });
      return res.status(500).json({ ok: false, error: 'Error al actualizar registro' });
    }
  });

  // DELETE /api/v1/fc-cert-reemplazos/:id  (soft delete, solo admin)
  router.delete('/:id', canDelete, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });

      await sequelize.query(
        'UPDATE fc_cert_reemplazos SET deleted_at = CURRENT_TIMESTAMP WHERE id = :id AND deleted_at IS NULL',
        { replacements: { id } }
      );

      (res.locals as Record<string, unknown>).audit = {
        action: 'fc_cert_reemplazos_delete',
        table_name: 'fc_cert_reemplazos',
        record_pk: id,
        request_json: {},
        response_json: { status: 200 },
      };

      return res.json({ ok: true });
    } catch (err: unknown) {
      logger.error({ msg: 'Error fc_cert_reemplazos DELETE', err });
      return res.status(500).json({ ok: false, error: 'Error al eliminar registro' });
    }
  });

  return router;
}
