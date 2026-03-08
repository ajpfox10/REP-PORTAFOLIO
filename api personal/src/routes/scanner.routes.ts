/**
 * @file routes/scanner.routes.ts
 * @description Endpoint que recibe notificaciones del Scanner API v3
 * + endpoint directo para escaneo desde la UI (guarda en DOCUMENTS_BASE_DIR/{DNI}/)
 *
 * FLUJO DIRECTO (desde EscaneoPage):
 *   POST /api/v1/scanner/scan-directo
 *   - Recibe: dni, tipo_documento, descripcion, usuario_id (operador)
 *   - Guarda el archivo en DOCUMENTS_BASE_DIR/{DNI}/{timestamp}_{tipo}.pdf
 *   - Registra en tblarchivos con: dni, ruta, tipo, escaneado_por (usuario_id), created_by
 *
 * FLUJO INTEGRADO (desde Scanner API v3):
 *   POST /api/v1/scanner/document-ready
 *   - Recibido desde el microservicio scanner cuando termina OCR
 *   - Guarda referencia en tblarchivos con ruta real en DOCUMENTS_BASE_DIR/{DNI}/
 */

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../logging/logger';
import { env } from '../config/env';
import fs from 'node:fs';
import path from 'node:path';

// ── Tipos de documentos disponibles para escanear ────────────────────────────
export const TIPOS_DOCUMENTO_ESCANER = [
  { value: 'dni_frente',             label: 'DNI - Frente' },
  { value: 'dni_dorso',              label: 'DNI - Dorso' },
  { value: 'titulo_secundario',      label: 'Título Secundario' },
  { value: 'titulo_universitario',   label: 'Título Universitario / Terciario' },
  { value: 'licencia_conducir',      label: 'Licencia de Conducir' },
  { value: 'acta_nacimiento',        label: 'Acta de Nacimiento' },
  { value: 'partida_matrimonio',     label: 'Partida de Matrimonio' },
  { value: 'contrato_trabajo',       label: 'Contrato de Trabajo' },
  { value: 'certificado_medico',     label: 'Certificado Médico' },
  { value: 'certificado_estudio',    label: 'Certificado de Estudios' },
  { value: 'recibo_sueldo',          label: 'Recibo de Sueldo' },
  { value: 'declaracion_jurada',     label: 'Declaración Jurada' },
  { value: 'resolucion',             label: 'Resolución' },
  { value: 'nota_pedido',            label: 'Nota / Pedido' },
  { value: 'jubilacion',             label: 'Documentación Jubilación' },
  { value: 'ioma',                   label: 'Documentación IOMA' },
  { value: 'foto_carnet',            label: 'Foto Carnet' },
  { value: 'otro',                   label: 'Otro documento' },
] as const;

/**
 * Crea la carpeta de destino para un DNI si no existe.
 * Retorna la ruta absoluta: DOCUMENTS_BASE_DIR/{DNI}/
 */
function resolveDestDir(dni: number): string {
  const base = env.DOCUMENTS_BASE_DIR;
  if (!base?.trim()) throw new Error('DOCUMENTS_BASE_DIR no configurado en .env');
  const destDir = path.join(base, String(dni));
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    logger.info({ msg: '[scanner] carpeta creada', destDir });
  }
  return destDir;
}

export function buildScannerRouter(sequelize: Sequelize): Router {
  const router = Router();

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/v1/scanner/tipos-documento
  // Lista los tipos de documento disponibles para escanear (para el front)
  // ─────────────────────────────────────────────────────────────────────────
  router.get('/tipos-documento', (_req: Request, res: Response) => {
    return res.json({ ok: true, data: TIPOS_DOCUMENTO_ESCANER });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/v1/scanner/document-ready
  // Recibido desde el Scanner API v3 cuando un documento termina de procesarse.
  // Auth: x-api-key
  // ─────────────────────────────────────────────────────────────────────────
  router.post('/document-ready', async (req: Request, res: Response) => {
    try {
      const {
        scanner_document_id,
        scanner_job_id,
        personal_dni,
        personal_ref,
        doc_class,
        page_count,
        storage_key,
        ocr_summary,
        escaneado_por,   // usuario_id del operador (opcional, enviado por el scanner)
      } = req.body || {};

      if (!personal_dni || !scanner_document_id) {
        return res.status(400).json({ ok: false, error: 'missing_fields: personal_dni y scanner_document_id son requeridos' });
      }

      const dniNum = Number(personal_dni);

      // Verificar que el agente existe
      const [agentes] = await sequelize.query(
        'SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1',
        { replacements: { dni: dniNum } }
      );
      if (!(agentes as any[]).length) {
        logger.warn({ msg: '[scanner] document-ready para DNI desconocido', personal_dni, scanner_document_id });
      }

      // Calcular ruta física en disco: DOCUMENTS_BASE_DIR/{DNI}/Scanner-{id}.pdf
      let rutaFisica: string | null = null;
      try {
        const destDir = resolveDestDir(dniNum);
        const fileName = `Scanner-${scanner_document_id}.pdf`;
        rutaFisica = path.join(String(dniNum), fileName); // relativa desde DOCUMENTS_BASE_DIR
      } catch (e: any) {
        logger.warn({ msg: '[scanner] no se pudo resolver destDir', error: e?.message });
      }

      const descripcion = [
        doc_class ? `Tipo: ${doc_class}` : null,
        page_count ? `Páginas: ${page_count}` : null,
        personal_ref ? `Ref: ${personal_ref}` : null,
        ocr_summary ? `Extracto: ${String(ocr_summary).slice(0, 200)}` : null,
      ].filter(Boolean).join(' | ');

      // Obtener actor del authContext si está disponible
      const auth = (req as any).auth;
      const operadorId = escaneado_por || auth?.principalId || null;

      await sequelize.query(
        `INSERT INTO tblarchivos
           (dni, nombre, tipo, descripcion_archivo, ruta, escaneado_por, created_by, created_at)
         VALUES
           (:dni, :nombre, :tipo, :descripcion, :ruta, :escaneadoPor, :createdBy, NOW())
         ON DUPLICATE KEY UPDATE
           descripcion_archivo = VALUES(descripcion_archivo),
           updated_at = NOW()`,
        {
          replacements: {
            dni:          dniNum,
            nombre:       `Scanner-${scanner_document_id}`,
            tipo:         doc_class || 'documento_escaneado',
            descripcion:  descripcion || 'Documento escaneado',
            ruta:         rutaFisica || `scanner://${storage_key}`,
            escaneadoPor: operadorId,
            createdBy:    operadorId,
          },
        }
      ).catch((e: any) => {
        // Fallback sin columna escaneado_por (instalaciones viejas)
        logger.warn({ msg: '[scanner] insert con escaneado_por falló, retry sin ella', error: e?.message });
        return sequelize.query(
          `INSERT INTO tblarchivos (dni, nombre, tipo, descripcion_archivo, ruta, created_at)
           VALUES (:dni, :nombre, :tipo, :descripcion, :ruta, NOW())
           ON DUPLICATE KEY UPDATE descripcion_archivo = VALUES(descripcion_archivo), updated_at = NOW()`,
          {
            replacements: {
              dni:         dniNum,
              nombre:      `Scanner-${scanner_document_id}`,
              tipo:        doc_class || 'documento_escaneado',
              descripcion: descripcion || 'Documento escaneado',
              ruta:        rutaFisica || `scanner://${storage_key}`,
            },
          }
        );
      });

      logger.info({ msg: '[scanner] document-ready registrado', personal_dni, scanner_document_id, doc_class, operadorId });
      return res.json({ ok: true });

    } catch (e: any) {
      logger.error({ msg: '[scanner] document-ready error', error: e?.message });
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/v1/scanner/registrar-escaneo
  // Endpoint directo desde la UI: registra un escaneo sin pasar por el scanner microservicio.
  // El archivo físico lo envía el scanner directamente al filesystem (vía agente o WIA).
  // Este endpoint solo registra la metadata en tblarchivos y crea la carpeta {DNI} si no existe.
  //
  // Body: { dni, tipo_documento, descripcion?, nombre_archivo, tamanio? }
  // Auth: JWT del operador (ya viene en authContext)
  // ─────────────────────────────────────────────────────────────────────────
  router.post('/registrar-escaneo', async (req: Request, res: Response) => {
    try {
      const { dni, tipo_documento, descripcion, nombre_archivo, tamanio } = req.body || {};

      if (!dni || !tipo_documento || !nombre_archivo) {
        return res.status(400).json({
          ok: false,
          error: 'Campos requeridos: dni, tipo_documento, nombre_archivo',
        });
      }

      const dniNum = Number(dni);
      if (!Number.isFinite(dniNum) || dniNum <= 0) {
        return res.status(400).json({ ok: false, error: 'DNI inválido' });
      }

      // Verificar que el tipo de documento es válido
      const tipoValido = TIPOS_DOCUMENTO_ESCANER.find(t => t.value === tipo_documento);
      if (!tipoValido) {
        return res.status(400).json({
          ok: false,
          error: `tipo_documento inválido. Valores aceptados: ${TIPOS_DOCUMENTO_ESCANER.map(t => t.value).join(', ')}`,
        });
      }

      // Verificar que el agente existe
      const [agentes] = await sequelize.query(
        'SELECT dni, apellido, nombre FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1',
        { replacements: { dni: dniNum }, type: QueryTypes.SELECT }
      );
      if (!(agentes as any[]).length) {
        return res.status(404).json({ ok: false, error: `Agente DNI ${dniNum} no encontrado` });
      }

      const auth = (req as any).auth;
      const operadorId = auth?.principalId || null;

      // Crear carpeta {DNI} si no existe
      let destDir: string;
      try {
        destDir = resolveDestDir(dniNum);
      } catch (e: any) {
        return res.status(500).json({ ok: false, error: `Error creando carpeta: ${e?.message}` });
      }

      // Nombre del archivo en disco: {timestamp}_{tipo}.pdf
      const ts = Date.now();
      const ext = path.extname(nombre_archivo) || '.pdf';
      const fileNameDisco = `${ts}_${tipo_documento}${ext}`;
      const rutaRelativa = path.join(String(dniNum), fileNameDisco); // {DNI}/{timestamp}_{tipo}.pdf

      const now = new Date();
      const descripcionFinal = descripcion || tipoValido.label;

      const [result] = await sequelize.query(
        `INSERT INTO tblarchivos
           (dni, nombre, tipo, descripcion_archivo, ruta, tamanio, fecha, anio, nombre_archivo_original, escaneado_por, created_by, created_at)
         VALUES
           (:dni, :nombre, :tipo, :descripcion, :ruta, :tamanio, :fecha, :anio, :originalName, :escaneadoPor, :createdBy, :createdAt)`,
        {
          replacements: {
            dni:          dniNum,
            nombre:       tipoValido.label,
            tipo:         tipo_documento,
            descripcion:  descripcionFinal,
            ruta:         rutaRelativa,
            tamanio:      tamanio ? String(tamanio) : null,
            fecha:        now.toISOString().split('T')[0],
            anio:         now.getFullYear(),
            originalName: nombre_archivo,
            escaneadoPor: operadorId,
            createdBy:    operadorId,
            createdAt:    now,
          },
        }
      ).catch((e: any) => {
        // Fallback sin escaneado_por (instalaciones sin esa columna)
        logger.warn({ msg: '[scanner] registrar-escaneo falló con escaneado_por, retry', error: e?.message });
        return sequelize.query(
          `INSERT INTO tblarchivos
             (dni, nombre, tipo, descripcion_archivo, ruta, tamanio, fecha, anio, nombre_archivo_original, created_by, created_at)
           VALUES
             (:dni, :nombre, :tipo, :descripcion, :ruta, :tamanio, :fecha, :anio, :originalName, :createdBy, :createdAt)`,
          {
            replacements: {
              dni:          dniNum,
              nombre:       tipoValido.label,
              tipo:         tipo_documento,
              descripcion:  descripcionFinal,
              ruta:         rutaRelativa,
              tamanio:      tamanio ? String(tamanio) : null,
              fecha:        now.toISOString().split('T')[0],
              anio:         now.getFullYear(),
              originalName: nombre_archivo,
              createdBy:    operadorId,
              createdAt:    now,
            },
          }
        );
      });

      const insertId = (result as any)?.insertId;

      // Registrar en audit
      (res.locals as any).audit = {
        action:       'scanner_escaneo_directo',
        table_name:   'tblarchivos',
        record_pk:    insertId,
        entity_table: 'tblarchivos',
        entity_pk:    insertId,
        request_json: { dni: dniNum, tipo_documento, nombre_archivo, operadorId },
        response_json: { status: 201, id: insertId },
      };

      logger.info({
        msg:        '[scanner] escaneo directo registrado',
        dniNum,
        tipo_documento,
        operadorId,
        rutaRelativa,
        insertId,
      });

      return res.status(201).json({
        ok: true,
        data: {
          id:            insertId,
          dni:           dniNum,
          tipo:          tipo_documento,
          tipo_label:    tipoValido.label,
          ruta:          rutaRelativa,
          destDir,
          fileNameDisco,
          escaneado_por: operadorId,
        },
      });

    } catch (e: any) {
      logger.error({ msg: '[scanner] registrar-escaneo error', error: e?.message });
      return res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/v1/scanner/documents/:dni
  // Retorna los documentos escaneados de un agente por DNI.
  // ─────────────────────────────────────────────────────────────────────────
  router.get('/documents/:dni', async (req: Request, res: Response) => {
    try {
      const dni = Number(req.params.dni);
      if (!dni) return res.status(400).json({ error: 'invalid_dni' });

      const rows = await sequelize.query(
        `SELECT id, nombre, tipo, descripcion_archivo, ruta, escaneado_por, created_by, created_at
         FROM tblarchivos
         WHERE dni = :dni
           AND (tipo LIKE '%dni%' OR tipo LIKE '%titulo%' OR tipo LIKE '%licencia%'
                OR tipo LIKE '%scanner%' OR tipo LIKE '%documento_escaneado%'
                OR tipo IN (${TIPOS_DOCUMENTO_ESCANER.map(() => '?').join(',')})
                OR ruta LIKE 'scanner://%')
           AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 200`,
        {
          replacements: [dni, ...TIPOS_DOCUMENTO_ESCANER.map(t => t.value)],
        }
      ).catch(() => [[]] as any);

      return res.json({ ok: true, data: (rows as any[])[0] || rows });
    } catch (e: any) {
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
