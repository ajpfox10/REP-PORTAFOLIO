import fs from 'fs';
import { Router, Request, Response } from 'express';
import { PDFDocument } from 'pdf-lib';
import { QueryTypes, Sequelize } from 'sequelize';
import { DocumentService, DocumentRow } from '../domains/personalv5/services/document.service';
import { logger } from '../logging/logger';

const NOMBRAMIENTO_TYPES = [
  { value: 'pronunciamiento_etico', label: 'Pronunciamiento Etico' },
  { value: 'cert_tareas', label: 'Certificacion de Tareas' },
  { value: 'planilla_compatibilidad', label: 'Planilla de Compatibilidad' },
  { value: 'cert_ips_beneficio', label: 'Certificado IPS Beneficio' },
  { value: 'cert_ips_aportes', label: 'Certificado IPS Aportes' },
  { value: 'antecedentes_nacionales', label: 'Antecedentes Nacionales' },
  { value: 'antecedentes_provinciales', label: 'Antecedentes Provinciales' },
  { value: 'matricula', label: 'Matricula' },
  { value: 'dj_condiciones_salud', label: 'Decl. Jurada de Condiciones de Salud' },
  { value: 'declaracion_jurada', label: 'Declaracion Jurada' },
  { value: 'preocupacional', label: 'Preocupacional' },
  { value: 'planilla_datos_personales', label: 'Planilla de Datos Personales y de Contacto' },
  { value: 'carta_ciudadania', label: 'Carta de Ciudadania' },
  { value: 'dni_hijos', label: 'DNI Hijos' },
  { value: 'dni_conyuge', label: 'DNI Conyuge' },
] as const;

const NOMBRAMIENTO_VALUES = NOMBRAMIENTO_TYPES.map((t) => t.value);
const ORDER_BY_TYPE: Map<string, number> = new Map(NOMBRAMIENTO_VALUES.map((value, index) => [value, index]));

type NombramientoDocRow = DocumentRow & {
  descripcion_archivo?: string | null;
  created_at?: string | null;
  fileUrl?: string;
};

function parseDni(value: string): number | null {
  const dni = Number(String(value || '').replace(/\D/g, ''));
  return Number.isFinite(dni) && dni > 0 ? dni : null;
}

function parseIds(value: unknown): number[] {
  return String(value || '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function sortNombramientoDocs(rows: NombramientoDocRow[]): NombramientoDocRow[] {
  return [...rows].sort((a, b) => {
    const ao = ORDER_BY_TYPE.get(String(a.tipo || '')) ?? 999;
    const bo = ORDER_BY_TYPE.get(String(b.tipo || '')) ?? 999;
    if (ao !== bo) return ao - bo;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

async function loadAgente(sequelize: Sequelize, dni: number) {
  const rows = await sequelize.query(
    `
      SELECT
        p.dni, p.apellido, p.nombre, p.cuil, p.email, p.telefono,
        a.legajo, a.estado_empleo, a.fecha_ingreso, a.fecha_de_nombramiento,
        (SELECT srv.nombre FROM agentes_servicios ags
         JOIN servicios srv ON srv.id = ags.servicio_id
         WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
         ORDER BY ags.id DESC LIMIT 1) AS servicio_nombre
      FROM personal p
      LEFT JOIN agentes a ON a.id = (
        SELECT ax.id FROM agentes ax
        WHERE ax.dni = p.dni AND ax.deleted_at IS NULL
        ORDER BY (ax.estado_empleo = 'ACTIVO' AND ax.fecha_egreso IS NULL) DESC, ax.id DESC
        LIMIT 1
      )
      WHERE p.dni = :dni AND p.deleted_at IS NULL
      LIMIT 1
    `,
    { replacements: { dni }, type: QueryTypes.SELECT }
  );
  return (rows as any[])[0] || null;
}

async function loadDocuments(sequelize: Sequelize, dni: number, ids: number[] = []) {
  const idFilter = ids.length ? 'AND id IN (:ids)' : '';
  const rows = await sequelize.query<NombramientoDocRow>(
    `
      SELECT
        id, dni, ruta, nombre, tipo, numero, fecha, anio, tamanio,
        descripcion_archivo, nombre_archivo_original, created_at,
        CONCAT('/api/v1/documents/', id, '/file') AS fileUrl
      FROM tblarchivos
      WHERE dni = :dni
        AND deleted_at IS NULL
        AND tipo IN (:tipos)
        ${idFilter}
      ORDER BY id DESC
    `,
    { replacements: { dni, tipos: NOMBRAMIENTO_VALUES, ids }, type: QueryTypes.SELECT }
  );

  return sortNombramientoDocs(rows);
}

export function buildNombramientoRouter(sequelize: Sequelize) {
  const router = Router();
  const documentService = new DocumentService(sequelize);

  router.get('/tipos', (_req: Request, res: Response) => {
    return res.json({ ok: true, data: NOMBRAMIENTO_TYPES });
  });

  router.get('/:dni', async (req: Request, res: Response) => {
    const dni = parseDni(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'DNI invalido' });

    try {
      const [agente, documents] = await Promise.all([
        loadAgente(sequelize, dni),
        loadDocuments(sequelize, dni),
      ]);

      if (!agente) {
        return res.status(404).json({ ok: false, error: `Agente DNI ${dni} no encontrado` });
      }

      const items = NOMBRAMIENTO_TYPES.map((tipo) => {
        const docs = documents.filter((doc) => doc.tipo === tipo.value);
        return {
          ...tipo,
          presente: docs.length > 0,
          cantidad: docs.length,
          ultimo: docs[0] || null,
          documentos: docs,
        };
      });

      const presentes = items.filter((item) => item.presente).length;

      return res.json({
        ok: true,
        data: {
          agente,
          tipos: NOMBRAMIENTO_TYPES,
          items,
          documents,
          summary: {
            total: NOMBRAMIENTO_TYPES.length,
            presentes,
            faltantes: NOMBRAMIENTO_TYPES.length - presentes,
          },
        },
      });
    } catch (err: any) {
      logger.error({ msg: '[nombramiento] list error', dni, err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al cargar nombramiento' });
    }
  });

  router.get('/:dni/combinado.pdf', async (req: Request, res: Response) => {
    const dni = parseDni(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'DNI invalido' });

    const ids = parseIds(req.query.ids);

    try {
      const agente = await loadAgente(sequelize, dni);
      if (!agente) {
        return res.status(404).json({ ok: false, error: `Agente DNI ${dni} no encontrado` });
      }

      const rows = await loadDocuments(sequelize, dni, ids);
      if (!rows.length) {
        return res.status(404).json({ ok: false, error: 'No hay documentos de nombramiento para combinar' });
      }

      const merged = await PDFDocument.create();
      const skipped: Array<{ id: number; reason: string }> = [];

      for (const doc of rows) {
        try {
          const resolved = await documentService.resolveFile(doc);
          const isPdf = resolved.mime.includes('pdf') || resolved.ext.toLowerCase() === 'pdf';
          if (!isPdf) {
            skipped.push({ id: doc.id, reason: 'no_pdf' });
            continue;
          }

          const sourceBytes = fs.readFileSync(resolved.fullPath);
          const sourcePdf = await PDFDocument.load(sourceBytes);
          const pageIndexes = sourcePdf.getPageIndices();
          const pages = await merged.copyPages(sourcePdf, pageIndexes);
          pages.forEach((page) => merged.addPage(page));
        } catch (err: any) {
          skipped.push({ id: doc.id, reason: err?.code || err?.message || 'error' });
        }
      }

      if (merged.getPageCount() === 0) {
        return res.status(422).json({
          ok: false,
          error: 'No se pudo combinar ningun PDF disponible',
          skipped,
        });
      }

      const pdfBytes = await merged.save();
      const filename = `nombramiento_${dni}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('X-P5-Skipped-Documents', encodeURIComponent(JSON.stringify(skipped)));
      return res.send(Buffer.from(pdfBytes));
    } catch (err: any) {
      logger.error({ msg: '[nombramiento] merge error', dni, err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al combinar PDFs' });
    }
  });

  return router;
}
