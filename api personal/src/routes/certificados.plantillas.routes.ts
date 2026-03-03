// src/routes/certificados.plantillas.routes.ts
import { Router, Request, Response } from "express";
import fs from 'fs';
import path from 'path';
import { Sequelize, QueryTypes } from "sequelize"; // ✅ IMPORTAR QueryTypes
import { requirePermission } from "../middlewares/rbacCrud";
import { logger } from "../logging/logger";
import { fillDocxTemplate } from './certificados.routes';

export function buildCertificadosPlantillasRouter(sequelize: Sequelize) {
  const router = Router();

  // GET /api/v1/certificados/plantillas - Listar plantillas disponibles
  router.get(
    '/',
    requirePermission('certificados:plantillas:read'),
    async (req: Request, res: Response) => {
      try {
        const templatesDir = path.join(process.cwd(), 'src', 'templates');
        
        if (!fs.existsSync(templatesDir)) {
          return res.json({ ok: true, data: [] });
        }

        const files = fs.readdirSync(templatesDir)
          .filter(f => f.endsWith('.docx'))
          .map(f => {
            const stat = fs.statSync(path.join(templatesDir, f));
            return {
              nombre: f,
              tamaño: stat.size,
              modificado: stat.mtime
            };
          });

        return res.json({ ok: true, data: files });

      } catch (err: any) {
        logger.error({ msg: 'Error listing templates', err });
        return res.status(500).json({ ok: false, error: 'Error al listar plantillas' });
      }
    }
  );

  // POST /api/v1/certificados/generate/:plantilla
  router.post(
    '/generate/:plantilla',
    requirePermission('certificados:generate'),
    async (req: Request, res: Response) => {
      try {
        const plantilla = req.params.plantilla;
        const dni = Number(req.body?.dni);
        
        if (!dni || isNaN(dni)) {
          return res.status(400).json({ ok: false, error: 'dni requerido' });
        }

        // ✅ CORREGIDO: Usar QueryTypes de la importación, NO de sequelize.QueryTypes
        const rowsResult = await sequelize.query(
          `SELECT dni, apellido, nombre, dependencia, ley, estado_empleo, fecha_ingreso
           FROM personaldetalle
           WHERE dni = :dni
           LIMIT 1`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        );
        
        // ✅ CORREGIDO: Asignar a variable y verificar
        const rows = rowsResult as any[];
        if (!rows || rows.length === 0) {
          return res.status(404).json({ ok: false, error: "Persona no encontrada" });
        }

        const p = rows[0];

        // Reemplazos estándar
        const replacements: Record<string, string> = {
          APELLIDOYNOMBRE: `${p.apellido ?? ''} ${p.nombre ?? ''}`.trim(),
          DNIP: String(p.dni ?? dni),
          DEPENDENCIA: String(p.dependencia ?? ''),
          LEGAJO: String(req.body?.legajo ?? ''),
          DECRETO: String(req.body?.decreto ?? ''),
          LUGARYFECHA: String(req.body?.lugar_y_fecha ?? ''),
        };

        // Plantilla
        const templatePath = path.join(process.cwd(), 'src', 'templates', plantilla);
        if (!fs.existsSync(templatePath)) {
          return res.status(404).json({ ok: false, error: 'Plantilla no encontrada' });
        }

        const tpl = fs.readFileSync(templatePath);
        const out = await fillDocxTemplate(tpl, replacements);

        (res.locals as any).audit = {
          action: 'certificado_generate',
          table_name: 'personaldetalle',
          record_pk: dni,
          request_json: { dni, plantilla, ...replacements },
          response_json: { status: 200, bytes: out.length },
        };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="certificado_${dni}.docx"`);
        res.setHeader('Content-Length', String(out.length));
        return res.status(200).send(out);

      } catch (err: any) {
        logger.error({ msg: 'Error generating certificate', err });
        return res.status(500).json({ ok: false, error: err?.message || 'Error' });
      }
    }
  );

  return router;
}