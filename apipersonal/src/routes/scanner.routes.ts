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
 *   - Descarga el archivo desde scanner API usando storage_key
 *   - Guarda el archivo en DOCUMENTS_BASE_DIR/{DNI}/
 *   - Guarda referencia en tblarchivos
 */

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../logging/logger';
import { env } from '../config/env';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';

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
 * Retorna la ruta absoluta: PHOTOS_BASE_DIR/{DNI}/
 */
function resolveDestDir(dni: number): string {
  const base = env.PHOTOS_BASE_DIR;
  if (!base?.trim()) throw new Error('PHOTOS_BASE_DIR no configurado en .env');
  const destDir = path.join(base, String(dni));
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    logger.info({ msg: '[scanner] carpeta creada', destDir });
  }
  return destDir;
}

function inferExtensionFromStorageKey(storageKey?: string | null): string {
  const ext = path.extname(String(storageKey || '')).toLowerCase();
  if (ext) return ext;
  return '.pdf';
}

function getScannerBaseUrl(): string {
  const raw =
    process.env.SCANNER_API_URL ||
    process.env.SCANNER_BASE_URL ||
    'http://localhost:3002';

  return String(raw).replace(/\/+$/, '');
}

function buildScannerFileUrl(storageKey: string): string {
  const base = getScannerBaseUrl();
  const encodedKey = storageKey
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  return `${base}/v1/documents/files/${encodedKey}`;
}

async function downloadScannerFile(storageKey: string): Promise<Buffer> {
  const url = buildScannerFileUrl(storageKey);
  const token = process.env.SCANNER_API_TOKEN || '';

  const res = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: {
      'x-tenant': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`scanner_download_failed status=${res.status} url=${url}`);
  }

  return Buffer.from(res.data);
}

export function buildScannerRouter(sequelize: Sequelize): Router {
  const router = Router();

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
        escaneado_por,
      } = req.body || {};

      if (!personal_dni || !scanner_document_id) {
        return res.status(400).json({ ok: false, error: 'missing_fields: personal_dni y scanner_document_id son requeridos' });
      }

      if (!storage_key) {
        return res.status(400).json({ ok: false, error: 'missing_fields: storage_key es requerido' });
      }

      const dniNum = Number(personal_dni);

      const agentes = await sequelize.query(
        'SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1',
        { replacements: { dni: dniNum }, type: QueryTypes.SELECT }
      );

      if (!(agentes as any[]).length) {
        logger.warn({ msg: '[scanner] document-ready para DNI desconocido', personal_dni, scanner_document_id });
      }

      const auth = (req as any).auth;
      const operadorId = escaneado_por || auth?.principalId || null;

      // 1. Resolver carpeta destino
      const destDir = resolveDestDir(dniNum);

      // 2. Conservar extensión real del archivo del scanner
      const ext = inferExtensionFromStorageKey(storage_key);
      const fileName = `Scanner-${scanner_document_id}${ext}`;

      // 3. Ruta relativa y absoluta
      const rutaRelativa = path.join(String(dniNum), fileName);
      const rutaAbsoluta = path.join(destDir, fileName);

      // 4. Descargar físicamente el archivo desde scanner API y escribirlo en disco
      try {
        const fileBuffer = await downloadScannerFile(String(storage_key));
        fs.writeFileSync(rutaAbsoluta, fileBuffer);
        logger.info({
          msg: '[scanner] archivo descargado y guardado',
          personal_dni,
          scanner_document_id,
          storage_key,
          rutaAbsoluta,
          bytes: fileBuffer.length,
        });
      } catch (e: any) {
        logger.error({
          msg: '[scanner] error descargando/escribiendo archivo',
          personal_dni,
          scanner_document_id,
          storage_key,
          rutaAbsoluta,
          error: e?.message,
        });
        return res.status(500).json({
          ok: false,
          error: `scanner_file_download_failed: ${e?.message || 'unknown_error'}`,
        });
      }

      const descripcion = [
        doc_class ? `Tipo: ${doc_class}` : null,
        page_count ? `Páginas: ${page_count}` : null,
        personal_ref ? `Ref: ${personal_ref}` : null,
        ocr_summary ? `Extracto: ${String(ocr_summary).slice(0, 200)}` : null,
      ].filter(Boolean).join(' | ');

      await sequelize.query(
        `INSERT INTO tblarchivos
           (dni, nombre, tipo, descripcion_archivo, ruta, escaneado_por, created_by, created_at)
         VALUES
           (:dni, :nombre, :tipo, :descripcion, :ruta, :escaneadoPor, :createdBy, NOW())
         ON DUPLICATE KEY UPDATE
           descripcion_archivo = VALUES(descripcion_archivo),
           ruta = VALUES(ruta),
           updated_at = NOW()`,
        {
          replacements: {
            dni:          dniNum,
            nombre:       fileName,
            tipo:         doc_class || 'documento_escaneado',
            descripcion:  descripcion || 'Documento escaneado',
            ruta:         rutaRelativa,
            escaneadoPor: operadorId,
            createdBy:    operadorId,
          },
        }
      ).catch((e: any) => {
        logger.warn({ msg: '[scanner] insert con escaneado_por falló, retry sin ella', error: e?.message });
        return sequelize.query(
          `INSERT INTO tblarchivos (dni, nombre, tipo, descripcion_archivo, ruta, created_at)
           VALUES (:dni, :nombre, :tipo, :descripcion, :ruta, NOW())
           ON DUPLICATE KEY UPDATE
             descripcion_archivo = VALUES(descripcion_archivo),
             ruta = VALUES(ruta),
             updated_at = NOW()`,
          {
            replacements: {
              dni:         dniNum,
              nombre:      fileName,
              tipo:        doc_class || 'documento_escaneado',
              descripcion: descripcion || 'Documento escaneado',
              ruta:        rutaRelativa,
            },
          }
        );
      });

      logger.info({
        msg: '[scanner] document-ready registrado',
        personal_dni,
        scanner_document_id,
        doc_class,
        operadorId,
        rutaRelativa,
        rutaAbsoluta,
      });

      return res.json({ ok: true });

    } catch (e: any) {
      logger.error({ msg: '[scanner] document-ready error', error: e?.message });
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

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

      const tipoValido = TIPOS_DOCUMENTO_ESCANER.find(t => t.value === tipo_documento);
      if (!tipoValido) {
        return res.status(400).json({
          ok: false,
          error: `tipo_documento inválido. Valores aceptados: ${TIPOS_DOCUMENTO_ESCANER.map(t => t.value).join(', ')}`,
        });
      }

      const agentes = await sequelize.query(
        'SELECT dni, apellido, nombre FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1',
        { replacements: { dni: dniNum }, type: QueryTypes.SELECT }
      );
      if (!(agentes as any[]).length) {
        return res.status(404).json({ ok: false, error: `Agente DNI ${dniNum} no encontrado` });
      }

      const auth = (req as any).auth;
      const operadorId = auth?.principalId || null;

      let destDir: string;
      try {
        destDir = resolveDestDir(dniNum);
      } catch (e: any) {
        return res.status(500).json({ ok: false, error: `Error creando carpeta: ${e?.message}` });
      }

      const ts = Date.now();
      const ext = path.extname(nombre_archivo) || '.pdf';
      const fileNameDisco = `${ts}_${tipo_documento}${ext}`;
      const rutaRelativa = path.join(String(dniNum), fileNameDisco);

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
