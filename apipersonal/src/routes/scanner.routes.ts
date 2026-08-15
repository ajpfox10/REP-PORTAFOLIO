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
  { value: 'cert_rotacion',          label: 'Certificacion de rotacion' },
  { value: 'dictamen_junta',         label: 'Dictamen Junta Médica' },
  { value: 'otro',                   label: 'Otro documento' },
  { value: 'legajo',                 label: 'Legajo' },
  { value: 'certificado_escolar',    label: 'Certificado Escolar' },
  { value: 'segunda_foto',           label: 'Segunda Foto' },
  // ── Nombramiento ──
  { value: 'pronunciamiento_etico',     label: 'Pronunciamiento Ético' },
  { value: 'cert_tareas',               label: 'Certificación de Tareas' },
  { value: 'planilla_compatibilidad',   label: 'Planilla de Compatibilidad' },
  { value: 'cert_ips_beneficio',        label: 'Certificado IPS Beneficio' },
  { value: 'cert_ips_aportes',          label: 'Certificado IPS Aportes' },
  { value: 'antecedentes_nacionales',   label: 'Antecedentes Nacionales' },
  { value: 'antecedentes_provinciales', label: 'Antecedentes Provinciales' },
  { value: 'matricula',                 label: 'Matrícula' },
  { value: 'dj_condiciones_salud',      label: 'Decl. Jurada de Condiciones de Salud' },
  { value: 'preocupacional',            label: 'Preocupacional' },
  { value: 'planilla_datos_personales', label: 'Planilla de Datos Personales y de Contacto' },
  { value: 'partida_nacimiento',        label: 'Partida de Nacimiento' },
  { value: 'carta_ciudadania',          label: 'Carta de Ciudadanía' },
  { value: 'dni_hijos',                 label: 'DNI Hijos' },
  { value: 'dni_conyuge',               label: 'DNI Cónyuge' },
  { value: 'cert_discapacidad',         label: 'Certificado de Discapacidad' },
  { value: 'dj_asignacion',             label: 'Decl. Jurada de Asignación' },
  { value: 'guarderia',                 label: 'Guardería' },
  { value: 'cedula_notificacion',       label: 'Cédula de Notificación' },
] as const;

function getScannerDocumentsBaseDir(): string {
  return (
    env.DOCUMENTS_SCAN_DIR?.trim() ||
    env.PHOTOS_BASE_DIR?.trim() ||
    env.DOCUMENTS_BASE_DIR?.trim() ||
    ''
  );
}

// ── Subcarpetas dentro del legajo del agente (DOCUMENTS_SCAN_DIR/<DNI>/...) ────
// La ruta relativa viaja SIEMPRE con '/' como separador (formato de "cable").
// Cada segmento se sanea para impedir path traversal y caracteres inválidos.
const SUBCARPETA_MAX = 60;
const SUBCARPETA_MAX_NIVELES = 3;

function sanitizeSegment(name: string): string {
  return String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ') // separadores, '|' y control
    .replace(/\s+/g, ' ')
    .replace(/^\.+$/, '')                        // nunca "." ni ".."
    .trim()
    .slice(0, SUBCARPETA_MAX);
}

/** Normaliza una ruta relativa 'a/b/c' → segmentos saneados unidos por '/'. */
function sanitizeRelPath(relPath: string): string {
  return String(relPath || '')
    .split('/')
    .map(sanitizeSegment)
    .filter(Boolean)
    .slice(0, SUBCARPETA_MAX_NIVELES)
    .join('/');
}

/** Convierte la ruta relativa saneada a segmentos aptos para path.join. */
function relToFsSegments(relPath: string): string[] {
  return sanitizeRelPath(relPath).split('/').filter(Boolean);
}

/**
 * Crea la carpeta de destino para un DNI si no existe.
 * subRelPath: subcarpeta(s) opcional(es) dentro del legajo (ej: 'Nombramiento/IPS').
 * useBaseDir=true → DOCUMENTS_BASE_DIR (ej: resoluciones page)
 * useBaseDir=false → DOCUMENTS_SCAN_DIR (flujo general)
 */
function resolveDestDir(dni: number, subRelPath = '', useBaseDir = false): string {
  const base = useBaseDir
    ? (env.DOCUMENTS_BASE_DIR?.trim() || getScannerDocumentsBaseDir())
    : getScannerDocumentsBaseDir();
  if (!base) throw new Error('DOCUMENTS_SCAN_DIR/DOCUMENTS_BASE_DIR no configurado en .env');
  const segs = relToFsSegments(subRelPath);
  const destDir = path.join(base, String(dni), ...segs);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    logger.info({ msg: '[scanner] carpeta creada', destDir });
  }
  return destDir;
}

function resolveResolucionesYVariosDestDir(): string {
  const destDir = env.DOCUMENTS_BASE_DIR?.trim();
  if (!destDir) throw new Error('DOCUMENTS_BASE_DIR no configurado en .env');
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    logger.info({ msg: '[scanner] carpeta de resoluciones y varios creada', destDir });
  }
  return destDir;
}

function inferExtensionFromStorageKey(storageKey?: string | null): string {
  const ext = path.extname(String(storageKey || '')).toLowerCase();
  if (ext) return ext;
  return '.pdf';
}

function getTipoDocumentoLabel(tipo?: string | null): string {
  const found = TIPOS_DOCUMENTO_ESCANER.find(t => t.value === tipo);
  return found?.label || String(tipo || 'Documento escaneado');
}

function safeDocumentFileBase(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Documento escaneado';
}

function buildResolucionFileBase(tipo: string, numero: string, year: number): string {
  return [tipo || 'RESO', String(year), numero].filter(Boolean).join('-');
}

function getScannerBaseUrl(override?: string | null): string {
  const raw =
    (override && String(override).trim()) ||
    process.env.SCANNER_API_URL ||
    process.env.SCANNER_BASE_URL ||
    'http://localhost:3002';

  return String(raw).replace(/\/+$/, '');
}

/**
 * El scanner indica en document-ready desde qué URL bajar el archivo (files_base_url).
 * Solo se confía si apunta a loopback (mismo host que api_personal): así el guardado
 * no depende del puerto fijo del .env y no se desincroniza entre dev/prod, sin abrir
 * un SSRF hacia hosts externos.
 */
function safeScannerBaseOverride(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    const host = u.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function buildScannerFileUrl(storageKey: string, baseOverride?: string | null): string {
  const base = getScannerBaseUrl(baseOverride);
  const encodedKey = storageKey
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  return `${base}/v1/documents/files/${encodedKey}`;
}

async function downloadScannerFile(storageKey: string, baseOverride?: string | null): Promise<Buffer> {
  const url = buildScannerFileUrl(storageKey, baseOverride);
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
        scan_job_id,
        personal_dni,
        personal_ref,
        doc_class,
        page_count,
        storage_key,
        ocr_summary,
        escaneado_por,
        page_index,
        page_total,
        files_base_url,
      } = req.body || {};

      if (!personal_dni || !scanner_document_id) {
        return res.status(400).json({ ok: false, error: 'missing_fields: personal_dni y scanner_document_id son requeridos' });
      }

      if (!storage_key) {
        return res.status(400).json({ ok: false, error: 'missing_fields: storage_key es requerido' });
      }

      const dniNum = Number(personal_dni);

      // ── Responder de inmediato para que el scanner API no agote su timeout de 30s.
      // El procesamiento (descarga, guardado en disco, INSERT en DB) se hace en async.
      res.json({ ok: true, queued: true });

      // ── Procesamiento async ──────────────────────────────────────────────────
      ;(async () => { try {

      const agentes = await sequelize.query(
        'SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1',
        { replacements: { dni: dniNum }, type: QueryTypes.SELECT }
      );

      if (!(agentes as any[]).length) {
        logger.warn({ msg: '[scanner] document-ready para DNI desconocido', personal_dni, scanner_document_id });
      }

      const auth = (req as any).auth;
      const operadorId = Number(escaneado_por || auth?.principalId) || null;

      // Detectar si viene de la página de resoluciones: personal_ref empieza con 'respage|'
      // personal_ref = 'respage|motivo|numero|fecha'
      const refParts  = (personal_ref || '').split('|');
      const isResolucionesYVariosPage = refParts[0] === 'respage';
      const refMotivo = isResolucionesYVariosPage ? (refParts[1] || '') : '';
      const refNumero = isResolucionesYVariosPage ? (refParts[2] || '') : '';
      const refFecha = isResolucionesYVariosPage ? (refParts[3] || '') : '';

      // Si es scan de la página de resoluciones pero el formulario todavía no fue guardado
      // (motivo y numero vacíos), saltar la creación del archivo. El frontend llama a
      // sync-personal después de que el usuario completa el form y guarda, momento en que
      // personal_ref tiene motivo/numero reales y el archivo puede nombrarse correctamente.
      if (isResolucionesYVariosPage && !refMotivo && !refNumero) {
        logger.info({
          msg: '[scanner] document-ready omitido: respage con form vacío (esperando sync-personal)',
          personal_dni,
          scanner_document_id,
        });
        return; // ya respondimos arriba
      }

      // Subcarpeta destino: el front codifica personal_ref = 'docu|<relpath>|<ref_real>'
      // (ej: 'docu|Nombramiento/IPS|cert_ips_aportes'). Sin ese prefijo → raíz del legajo.
      let subRelPath = '';
      let effectiveRef = personal_ref || '';
      if (typeof personal_ref === 'string' && personal_ref.startsWith('docu|')) {
        const dp = personal_ref.split('|');
        subRelPath = sanitizeRelPath(dp[1] || '');
        effectiveRef = dp.slice(2).join('|') || doc_class || '';
      }

      const tipoArchivo = isResolucionesYVariosPage
        ? (refMotivo || 'resolucion')
        : (TIPOS_DOCUMENTO_ESCANER.find(t => t.value === effectiveRef)?.value ||
           TIPOS_DOCUMENTO_ESCANER.find(t => t.value === doc_class)?.value ||
           doc_class || 'documento_escaneado');

      // 1 JPG por página: sufijo para que cada página tenga nombre y ruta distintos
      // (el escaneo JPG con ADF/dúplex llega como N notificaciones, una por página).
      const pageIdx = Number(page_index) || 0;
      const pageTot = Number(page_total) || 0;
      const hasPageSuffix = !isResolucionesYVariosPage && pageTot > 1 && pageIdx > 0;
      const pageSuffix = hasPageSuffix ? ` (${pageIdx}-${pageTot})` : '';

      const nombreDocumento = (isResolucionesYVariosPage
        ? [refMotivo, refNumero].filter(Boolean).join(' — ') || getTipoDocumentoLabel('resolucion')
        : getTipoDocumentoLabel(tipoArchivo)) + pageSuffix;

      const now = new Date();
      const fechaDocumento = refFecha || now.toISOString().slice(0, 10);
      const anioDocumento = Number(String(fechaDocumento).slice(0, 4)) || now.getFullYear();

      // 1. Resolver carpeta destino (resoluciones → DOCUMENTS_BASE_DIR, resto → DOCUMENTS_SCAN_DIR)
      const destDir = isResolucionesYVariosPage ? resolveResolucionesYVariosDestDir() : resolveDestDir(dniNum, subRelPath);

      // 2. Conservar extensión real del archivo del scanner
      const ext = inferExtensionFromStorageKey(storage_key);
      const fileBase = isResolucionesYVariosPage && (refMotivo || refNumero)
        ? buildResolucionFileBase(refMotivo, refNumero, anioDocumento)
        : nombreDocumento;
      const preferredFileName = `${safeDocumentFileBase(fileBase)}${ext}`;
      // Para resoluciones: siempre usar el nombre preferido (sobreescribir si ya existe).
      // Evita que la segunda llamada (sync-personal tras el auto-worker) genere un duplicado
      // con el scanner_document_id appended. El archivo queda con el nombre limpio.
      const fileName = isResolucionesYVariosPage
        ? preferredFileName
        : !fs.existsSync(path.join(destDir, preferredFileName))
          ? preferredFileName
          : `${safeDocumentFileBase(fileBase)}-${scanner_document_id}${ext}`;

      // 3. Ruta relativa y absoluta (respetando la subcarpeta elegida)
      const rutaRelativa = isResolucionesYVariosPage
        ? fileName
        : path.join(String(dniNum), ...relToFsSegments(subRelPath), fileName);
      const rutaAbsoluta = path.join(destDir, fileName);

      // 4. Descargar físicamente el archivo desde scanner API y escribirlo en disco
      try {
        const fileBuffer = await downloadScannerFile(String(storage_key), safeScannerBaseOverride(files_base_url));
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
        return; // ya respondimos, solo logueamos el error
      }

      const descripcion = [
        doc_class ? `Tipo: ${doc_class}` : null,
        hasPageSuffix ? `Página ${pageIdx} de ${pageTot}` : (page_count ? `Páginas: ${page_count}` : null),
        effectiveRef ? `Ref: ${effectiveRef}` : null,
        subRelPath ? `Carpeta: ${subRelPath}` : null,
        ocr_summary ? `Extracto: ${String(ocr_summary).slice(0, 200)}` : null,
      ].filter(Boolean).join(' | ');

      const existingRows = await sequelize.query(
        `SELECT id FROM tblarchivos
         WHERE dni = :dni AND ruta = :ruta AND deleted_at IS NULL
         LIMIT 1`,
        {
          replacements: { dni: dniNum, ruta: rutaRelativa },
          type: QueryTypes.SELECT,
        }
      ).catch(() => [] as any[]);

      const existingId = (existingRows as any[])[0]?.id;
      if (existingId) {
        await sequelize.query(
          `UPDATE tblarchivos
              SET nombre = :nombre,
                  tipo = :tipo,
                  numero = :numero,
                  descripcion_archivo = :descripcion,
                  updated_by = COALESCE(:updatedBy, updated_by),
                  updated_at = NOW()
            WHERE id = :id`,
          {
            replacements: {
              id: existingId,
              nombre: nombreDocumento,
              tipo: tipoArchivo,
              numero: refNumero || null,
              descripcion: descripcion || 'Documento escaneado',
              updatedBy: operadorId,
            },
          }
        );

        await sequelize.query(
          `INSERT INTO audit_log
             (usuario_id, action, table_name, record_pk, route, actor_type, actor_id, method, entity_table, entity_pk, request_json, response_json, created_at)
           VALUES
             (:usuarioId, 'scanner_document_saved', 'tblarchivos', :recordPk, '/api/v1/scanner/document-ready',
              :actorType, :actorId, 'POST', 'tblarchivos', :recordPk, :requestJson, :responseJson, NOW())`,
          {
            replacements: {
              usuarioId: operadorId,
              actorType: operadorId ? 'user' : 'api_key',
              actorId: operadorId,
              recordPk: String(existingId),
              requestJson: JSON.stringify({
                dni: dniNum,
                ruta: rutaRelativa,
                tipo: tipoArchivo,
                scanner_document_id,
                scanner_job_id: scanner_job_id || scan_job_id,
                storage_key,
                operadorId,
                mode: 'update',
              }),
              responseJson: JSON.stringify({ status: 200, id: existingId }),
            },
          }
        ).catch((e: any) => logger.warn({ msg: '[scanner] audit document-ready update falló', error: e?.message }));

        logger.info({
          msg: '[scanner] document-ready actualizado',
          personal_dni,
          scanner_document_id,
          scanner_job_id: scanner_job_id || scan_job_id,
          tipoArchivo,
          rutaRelativa,
          rutaAbsoluta,
        });

        return; // ya respondimos
      }

      await sequelize.query(
        `INSERT INTO tblarchivos
           (dni, nombre, tipo, numero, fecha, anio, descripcion_archivo, nombre_archivo_original, ruta, escaneado_por, created_by, created_at)
         VALUES
           (:dni, :nombre, :tipo, :numero, :fecha, :anio, :descripcion, :originalName, :ruta, :escaneadoPor, :createdBy, NOW())
         ON DUPLICATE KEY UPDATE
           nombre = VALUES(nombre),
           tipo = VALUES(tipo),
           numero = VALUES(numero),
           fecha = VALUES(fecha),
           anio = VALUES(anio),
           descripcion_archivo = VALUES(descripcion_archivo),
           nombre_archivo_original = VALUES(nombre_archivo_original),
           ruta = VALUES(ruta),
           escaneado_por = COALESCE(VALUES(escaneado_por), escaneado_por),
           updated_by = COALESCE(VALUES(created_by), updated_by),
           updated_at = NOW()`,
        {
          replacements: {
            dni:          dniNum,
            nombre:       nombreDocumento,
            tipo:         tipoArchivo,
            numero:       refNumero || null,
            fecha:        fechaDocumento,
            anio:         anioDocumento,
            descripcion:  descripcion || 'Documento escaneado',
            originalName: fileName,
            ruta:         rutaRelativa,
            escaneadoPor: operadorId,
            createdBy:    operadorId,
          },
        }
      ).catch((e: any) => {
        logger.warn({ msg: '[scanner] insert con escaneado_por falló, retry sin ella', error: e?.message });
        return sequelize.query(
          `INSERT INTO tblarchivos (dni, nombre, tipo, numero, fecha, anio, descripcion_archivo, nombre_archivo_original, ruta, created_at)
           VALUES (:dni, :nombre, :tipo, :numero, :fecha, :anio, :descripcion, :originalName, :ruta, NOW())
           ON DUPLICATE KEY UPDATE
             nombre = VALUES(nombre),
             tipo = VALUES(tipo),
             numero = VALUES(numero),
             fecha = VALUES(fecha),
             anio = VALUES(anio),
             descripcion_archivo = VALUES(descripcion_archivo),
             nombre_archivo_original = VALUES(nombre_archivo_original),
             ruta = VALUES(ruta),
             updated_at = NOW()`,
          {
            replacements: {
              dni:         dniNum,
              nombre:      nombreDocumento,
              tipo:        tipoArchivo,
              numero:      refNumero || null,
              fecha:       fechaDocumento,
              anio:        anioDocumento,
              descripcion: descripcion || 'Documento escaneado',
              originalName: fileName,
              ruta:        rutaRelativa,
            },
          }
        );
      });

      const savedRows = await sequelize.query(
        `SELECT id FROM tblarchivos
         WHERE dni = :dni AND ruta = :ruta AND deleted_at IS NULL
         ORDER BY id DESC
         LIMIT 1`,
        {
          replacements: { dni: dniNum, ruta: rutaRelativa },
          type: QueryTypes.SELECT,
        }
      ).catch(() => [] as any[]);
      const savedId = (savedRows as any[])[0]?.id ?? null;

      await sequelize.query(
        `INSERT INTO audit_log
           (usuario_id, action, table_name, record_pk, route, actor_type, actor_id, method, entity_table, entity_pk, request_json, response_json, created_at)
         VALUES
           (:usuarioId, 'scanner_document_saved', 'tblarchivos', :recordPk, '/api/v1/scanner/document-ready',
            :actorType, :actorId, 'POST', 'tblarchivos', :recordPk, :requestJson, :responseJson, NOW())`,
        {
          replacements: {
            usuarioId: operadorId,
            actorType: operadorId ? 'user' : 'api_key',
            actorId: operadorId,
            recordPk: savedId != null ? String(savedId) : null,
            requestJson: JSON.stringify({
              dni: dniNum,
              ruta: rutaRelativa,
              tipo: tipoArchivo,
              scanner_document_id,
              scanner_job_id: scanner_job_id || scan_job_id,
              storage_key,
              operadorId,
              mode: 'insert',
            }),
            responseJson: JSON.stringify({ status: 201, id: savedId }),
          },
        }
      ).catch((e: any) => logger.warn({ msg: '[scanner] audit document-ready insert falló', error: e?.message }));

      logger.info({
        msg: '[scanner] document-ready registrado',
        personal_dni,
        scanner_document_id,
        scanner_job_id: scanner_job_id || scan_job_id,
        tipoArchivo,
        operadorId,
        rutaRelativa,
        rutaAbsoluta,
      });

      // procesamiento terminado OK
    } catch (e: any) {
      logger.error({ msg: '[scanner] document-ready async error', error: e?.message });
    } })().catch((e: any) =>
      logger.error({ msg: '[scanner] document-ready unhandled async error', error: e?.message })
    );

  } catch (e: any) {
    // Solo llega aquí si la validación tiró una excepción no controlada antes del res.json
    logger.error({ msg: '[scanner] document-ready error pre-respuesta', error: e?.message });
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'internal_error' });
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

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/v1/scanner/subcarpetas/:dni?path=<relpath>
  // Lista las subcarpetas (directorios) inmediatas dentro de DOCUMENTS_SCAN_DIR/<DNI>/<relpath>.
  // ─────────────────────────────────────────────────────────────────────────
  router.get('/subcarpetas/:dni', (req: Request, res: Response) => {
    try {
      const dni = Number(req.params.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'invalid_dni' });

      const base = getScannerDocumentsBaseDir();
      if (!base) return res.status(500).json({ ok: false, error: 'DOCUMENTS_SCAN_DIR no configurado' });

      const relPath = sanitizeRelPath(String(req.query.path || ''));
      const dir = path.join(base, String(dni), ...relToFsSegments(relPath));

      let data: string[] = [];
      if (fs.existsSync(dir)) {
        data = fs.readdirSync(dir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name)
          .sort((a, b) => a.localeCompare(b, 'es'));
      }
      return res.json({ ok: true, data });
    } catch (e: any) {
      logger.error({ msg: '[scanner] subcarpetas list error', error: e?.message, dni: req.params.dni });
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/v1/scanner/subcarpetas/:dni  body: { path?: string, nombre: string }
  // Crea la carpeta DOCUMENTS_SCAN_DIR/<DNI>/<path>/<nombre> (idempotente).
  // ─────────────────────────────────────────────────────────────────────────
  router.post('/subcarpetas/:dni', (req: Request, res: Response) => {
    try {
      const dni = Number(req.params.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'invalid_dni' });

      const parentRel = sanitizeRelPath(String(req.body?.path || ''));
      const nombre = sanitizeSegment(String(req.body?.nombre || ''));
      if (!nombre) return res.status(400).json({ ok: false, error: 'nombre_invalido' });

      const relPath = [parentRel, nombre].filter(Boolean).join('/');
      if (relToFsSegments(relPath).length > SUBCARPETA_MAX_NIVELES) {
        return res.status(400).json({ ok: false, error: 'max_niveles' });
      }

      const destDir = resolveDestDir(dni, relPath);
      logger.info({ msg: '[scanner] subcarpeta creada', dni, relPath, destDir });
      return res.status(201).json({ ok: true, data: { path: relPath, nombre } });
    } catch (e: any) {
      logger.error({ msg: '[scanner] subcarpeta create error', error: e?.message });
      return res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
    }
  });

  router.get('/documents/:dni', async (req: Request, res: Response) => {
    try {
      const dni = Number(req.params.dni);
      if (!dni) return res.status(400).json({ error: 'invalid_dni' });

      const tipoParams = TIPOS_DOCUMENTO_ESCANER.map((_, i) => `:tipo${i}`).join(',');
      const replacements: Record<string, any> = {
        dni,
        rutaDniSlash: `${dni}/%`,
        rutaDniBackslash: `${dni}\\%`,
        rutaAnyDniSlash: `%/${dni}/%`,
        rutaAnyDniBackslash: `%\\${dni}\\%`,
      };
      TIPOS_DOCUMENTO_ESCANER.forEach((tipo, i) => {
        replacements[`tipo${i}`] = tipo.value;
      });

      const rows = await sequelize.query(
        `SELECT a.id, a.nombre, a.tipo, a.descripcion_archivo, a.ruta, a.escaneado_por, a.created_by, a.created_at,
                COALESCE(u.nombre, u.email) AS escaneado_por_nombre,
                u.email AS escaneado_por_email
         FROM tblarchivos a
         LEFT JOIN usuarios u ON u.id = COALESCE(a.escaneado_por, a.created_by)
         WHERE a.dni = :dni
           AND (a.tipo LIKE '%dni%' OR a.tipo LIKE '%titulo%' OR a.tipo LIKE '%licencia%'
                OR a.tipo LIKE '%scanner%' OR a.tipo LIKE '%documento_escaneado%'
                OR a.tipo IN ('identificacion', 'general', 'certificado', 'titulo', 'solicitud')
                OR a.tipo IN (${tipoParams})
                OR a.ruta LIKE 'scanner://%'
                OR a.ruta LIKE :rutaDniSlash
                OR a.ruta LIKE :rutaDniBackslash
                OR a.ruta LIKE :rutaAnyDniSlash
                OR a.ruta LIKE :rutaAnyDniBackslash)
           AND a.deleted_at IS NULL
         ORDER BY a.created_at DESC
         LIMIT 200`,
        {
          replacements,
          type: QueryTypes.SELECT,
        }
      );

      return res.json({ ok: true, data: rows });
    } catch (e: any) {
      logger.error({ msg: '[scanner] documents list error', error: e?.message, dni: req.params.dni });
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
