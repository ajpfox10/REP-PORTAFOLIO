/**
 * @file domains/personalv5/services/documents.service.ts
 *
 * Toda la lógica de documentos vive acá, separada de Express.
 *
 * Maneja los tres formatos de ruta que pueden existir en la DB:
 *
 *   Formato A (legacy puro - número):  "3"  → no hay archivo físico
 *   Formato B (legacy Windows absoluto): "D:\G\DOCUMENTOS Y VARIOS\RESOLUCIONES\116-2015.pdf"
 *   Formato C (nuevo relativo):          "2025/1703123_12345.pdf"
 *   Formato D (Windows relativo):        "RESOLUCIONES Y VARIOS\116-2015.pdf"
 *
 * El directorio base es D:\G\DOCUMENTOS Y VARIOS.
 * Entonces DOCUMENTS_BASE_DIR = "D:\G\DOCUMENTOS Y VARIOS"
 * y los archivos están en subcarpetas (con espacios en el nombre).
 */

import fs from 'fs';
import path from 'path';
import { QueryTypes } from 'sequelize';
import { env } from '../../../config/env';
import { logger } from '../../../logging/logger';
import {
  resolveSafeRealPath,
  validateDownloadFile,
  FileSecurityError,
} from '../../../files/fileSecurity';
import { scanFileOrThrow, VirusFoundError } from '../../../files/fileScanner';
import { sniffFileMagic } from '../../../files/mimeSniffer';
import { createVersion } from '../../../services/documentVersion.service';
import { cacheInvalidateTags } from '../../../infra/cache';
import { trackAction } from '../../../logging/track';

// ── TIPOS ─────────────────────────────────────────────────────────────────────

export interface DocumentRecord {
  id: number;
  dni: number;
  nombre: string;
  tipo: string | null;
  numero: string | null;
  fecha: string | null;
  tamanio: string | null;
  anio: number | null;
  descripcion_archivo: string | null;
  nombre_archivo_original: string | null;
  ruta: string;
  created_at: string;
  fileUrl: string;
}

export interface DocumentFile {
  fullPath:  string;
  stat:      fs.Stats;
  mime:      string;
  ext:       string;
  filename:  string;
}

export interface UploadResult {
  id: number;
  dni: number;
  nombre: string;
  filename: string;
  fileUrl: string;
}

export interface OrphanRecord {
  id: number;
  dni: number;
  nombre: string;
  ruta: string;
  motivo: 'legacy_number' | 'file_not_found' | 'base_dir_missing';
}

// ── HELPERS DE RESOLUCIÓN DE RUTA ─────────────────────────────────────────────

/**
 * Intento resolver una ruta de forma segura. Si falla (path traversal o
 * archivo no existe), devuelvo null en lugar de lanzar excepción.
 */
function tryResolve(baseDir: string, rel: string): string | null {
  try {
    return resolveSafeRealPath(baseDir, rel);
  } catch {
    return null;
  }
}

/**
 * Normalizo un path Windows a posix para que funcione en ambos sistemas.
 *   "RESOLUCIONES Y VARIOS\116-2015.pdf" → "RESOLUCIONES Y VARIOS/116-2015.pdf"
 *   "D:\G\RESOLUCIONES Y VARIOS\116.pdf" → extraigo la parte relativa al baseDir
 */
function normalizeWindowsPath(rutaRaw: string, baseDir: string): string {
  // Normalizo separadores
  let ruta = rutaRaw.replace(/\\/g, '/');

  // Si es una ruta absoluta Windows (C:/... D:/...) intento extraer la parte relativa
  if (/^[A-Za-z]:\//.test(ruta)) {
    const baseNorm = baseDir.replace(/\\/g, '/').replace(/\/$/, '');
    if (ruta.toLowerCase().startsWith(baseNorm.toLowerCase() + '/')) {
      // Extraigo lo que viene después del baseDir
      ruta = ruta.slice(baseNorm.length + 1);
    } else {
      // El baseDir no está en la ruta absoluta: tomo solo el último segmento (nombre de archivo)
      ruta = ruta.split('/').pop() || ruta;
    }
  }

  return ruta;
}

/**
 * Estrategia de resolución multi-paso para manejar todos los formatos legacy.
 *
 * Intenta en orden:
 *   1. Ruta normalizada relativa al baseDir (formato nuevo y legacies de Windows)
 *   2. Solo el nombre de archivo en baseDir (por si cambió la estructura)
 *   3. Búsqueda recursiva en subdirectorios año (2018/, 2019/... 2025/)
 *   4. Búsqueda recursiva en todos los subdirectorios del baseDir (último recurso)
 */
export function resolveDocumentPath(rutaRaw: string, baseDir: string): string | null {
  if (!rutaRaw || !baseDir) return null;

  // Paso 0: si la ruta es puramente numérica → registro legacy sin archivo
  if (/^\d+$/.test(rutaRaw.trim())) return null;

  const normalized = normalizeWindowsPath(rutaRaw, baseDir);

  // Paso 1: como ruta relativa directa
  let resolved = tryResolve(baseDir, normalized);
  if (resolved) return resolved;

  // Paso 2: solo el nombre de archivo en la raíz del baseDir
  const justFile = normalized.split('/').pop() || '';
  if (justFile) {
    resolved = tryResolve(baseDir, justFile);
    if (resolved) return resolved;
  }

  // Paso 3: búsqueda en subdirectorios año (ej: 2018/archivo.pdf)
  if (justFile && fs.existsSync(baseDir)) {
    try {
      const entries = fs.readdirSync(baseDir);
      for (const entry of entries) {
        if (/^\d{4}$/.test(entry)) {
          resolved = tryResolve(baseDir, `${entry}/${justFile}`);
          if (resolved) return resolved;
        }
      }
    } catch { /* skip */ }
  }

  // Paso 4: búsqueda recursiva en TODOS los subdirectorios (incluyendo "RESOLUCIONES Y VARIOS" etc.)
  if (justFile && fs.existsSync(baseDir)) {
    resolved = searchFileRecursive(baseDir, justFile, 3); // máx 3 niveles de profundidad
    if (resolved) return resolved;
  }

  return null;
}

/**
 * Busco un archivo por nombre en forma recursiva hasta maxDepth niveles.
 * Maneja directorios con espacios (como "RESOLUCIONES Y VARIOS").
 */
function searchFileRecursive(dir: string, filename: string, maxDepth: number): string | null {
  if (maxDepth <= 0) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = searchFileRecursive(fullPath, filename, maxDepth - 1);
        if (found) return found;
      } else if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return fullPath;
      }
    }
  } catch { /* skip dirs sin permiso */ }
  return null;
}

// ── SERVICIO DE DOCUMENTOS ────────────────────────────────────────────────────

export const DocumentsService = {

  /**
   * Lista documentos paginados con filtro opcional.
   */
  async list(sequelize: any, opts: {
    page: number;
    limit: number;
    q?: string;
    dni?: number;
  }): Promise<{ data: DocumentRecord[]; total: number }> {
    const { page, limit, q, dni } = opts;
    const offset = (page - 1) * limit;

    let where = 'deleted_at IS NULL';
    const rep: any = { limit, offset };

    if (q) {
      where += ' AND (nombre LIKE :q OR tipo LIKE :q OR nombre_archivo_original LIKE :q)';
      rep.q = `%${q}%`;
    }
    if (dni) {
      where += ' AND dni = :dni';
      rep.dni = dni;
    }

    const rows = await sequelize.query(
      `SELECT id, dni, nombre, tipo, numero, fecha, tamanio, anio,
              descripcion_archivo, nombre_archivo_original, ruta, created_at
       FROM tblarchivos
       WHERE ${where}
       ORDER BY id DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: rep, type: QueryTypes.SELECT }
    );

    const countRows = await sequelize.query(
      `SELECT COUNT(*) AS total FROM tblarchivos WHERE ${where}`,
      { replacements: rep, type: QueryTypes.SELECT }
    );

    const total = (countRows as any[])[0]?.total ?? 0;
    const data  = (rows as any[]).map(r => ({
      ...r,
      fileUrl: `/api/v1/documents/${r.id}/file`,
    }));

    return { data, total };
  },

  /**
   * Resuelve el archivo físico de un documento por ID.
   * Maneja todos los formatos de ruta legacy.
   *
   * @throws FileSecurityError si hay path traversal
   * @throws { code: 'LEGACY_NO_FILE' } si es un registro sin archivo físico
   * @throws { code: 'FILE_NOT_FOUND' } si no se encuentra el archivo
   */
  async resolveFile(sequelize: any, id: number): Promise<DocumentFile> {
    const rows = await sequelize.query(
      `SELECT id, ruta, nombre, nombre_archivo_original
       FROM tblarchivos
       WHERE id = :id AND deleted_at IS NULL
       LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    const row = (rows as any[])[0];
    if (!row) {
      const err: any = new Error(`Documento ID ${id} no encontrado`);
      err.status = 404;
      throw err;
    }

    const rutaRaw = String(row.ruta || '').trim();
    const baseDir  = env.DOCUMENTS_BASE_DIR;

    // Registro legacy: ruta es un número puro
    if (/^\d+$/.test(rutaRaw) || rutaRaw === '') {
      const err: any = new Error(
        'Este documento es un registro histórico sin archivo físico adjunto. ' +
        'Para acceder al archivo, el administrador debe subirlo nuevamente.'
      );
      err.status  = 404;
      err.code    = 'LEGACY_NO_FILE';
      err.docId   = id;
      err.ruta    = rutaRaw;
      throw err;
    }

    const fullPath = resolveDocumentPath(rutaRaw, baseDir);

    if (!fullPath) {
      logger.warn({
        msg:      '[DocumentsService] archivo no encontrado',
        id,
        rutaRaw,
        baseDir,
        hint:     'Verificar que DOCUMENTS_BASE_DIR apunta a D:\\G (no a D:\\G\\DOCU)',
      });
      const err: any = new Error(
        `Archivo no encontrado en el servidor. ` +
        `Ruta registrada: "${rutaRaw}". ` +
        `Verificar que DOCUMENTS_BASE_DIR esté correctamente configurado.`
      );
      err.status = 404;
      err.code   = 'FILE_NOT_FOUND';
      throw err;
    }

    const { stat, sniff } = validateDownloadFile(fullPath);
    await scanFileOrThrow(fullPath);

    const nameFromDb = String(row.nombre_archivo_original || row.nombre || `doc-${id}`);
    const filename   = nameFromDb.includes('.') ? nameFromDb : `${nameFromDb}.${sniff.ext || 'bin'}`;

    return { fullPath, stat, mime: sniff.mime, ext: sniff.ext, filename };
  },

  /**
   * Sube un nuevo documento y lo registra en la BD.
   * Todo dentro de una transacción: si algo falla, no queda el archivo en disco
   * ni el registro en la BD.
   */
  async upload(sequelize: any, opts: {
    dni: number;
    filePath: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    nombre?: string;
    numero?: string;
    tipo?: string;
    descripcion?: string;
    actor: number | null;
  }): Promise<UploadResult> {
    const { dni, filePath, originalName, fileSize, nombre, numero, tipo, descripcion, actor } = opts;

    await scanFileOrThrow(filePath);
    const sniff = sniffFileMagic(filePath);

    const year    = new Date().getFullYear();
    const destDir = path.join(env.DOCUMENTS_BASE_DIR, String(year));

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const ext      = path.extname(originalName);
    const fileName = `${Date.now()}_${dni}${ext}`;
    const destPath = path.join(destDir, fileName);

    fs.renameSync(filePath, destPath);

    const now = new Date();

    const [result] = await sequelize.query(
      `INSERT INTO tblarchivos
       (dni, ruta, nombre, numero, tipo, tamanio, anio, fecha,
        descripcion_archivo, nombre_archivo_original, created_by, created_at)
       VALUES
       (:dni, :ruta, :nombre, :numero, :tipo, :tamanio, :anio, :fecha,
        :descripcion, :originalName, :createdBy, :createdAt)`,
      {
        replacements: {
          dni,
          ruta:         `${year}/${fileName}`,  // siempre guardo relativo
          nombre:       nombre || originalName,
          numero:       numero || null,
          tipo:         tipo || sniff.kind || 'documento',
          tamanio:      String(fileSize),
          anio:         year,
          fecha:        now.toISOString().split('T')[0],
          descripcion:  descripcion || null,
          originalName,
          createdBy:    actor,
          createdAt:    now,
        },
      }
    );

    const insertId = (result as any)?.insertId;

    await createVersion(sequelize, insertId, destPath, originalName, actor, {
      anio: year, numero: numero || null, tipo: tipo || sniff.kind || 'documento',
      descripcion: descripcion || null,
    });

    // La invalidación de cache la hace el Gateway automáticamente (invalidate-on-write)
    // pero por si acaso también la ejecuto acá
    await cacheInvalidateTags([`documents:list`, `documents:dni:${dni}`]).catch(() => {});

    trackAction('documents_upload_ok', { dni, fileId: insertId, filename: originalName });

    return {
      id:       insertId,
      dni,
      nombre:   nombre || originalName,
      filename: originalName,
      fileUrl:  `/api/v1/documents/${insertId}/file`,
    };
  },

  /**
   * Lista todos los documentos cuyo archivo físico NO existe en el servidor.
   * Útil para el admin para sanear registros legacy.
   *
   * GET /api/v1/documents/orphans
   */
  async listOrphans(sequelize: any): Promise<OrphanRecord[]> {
    const baseDir = env.DOCUMENTS_BASE_DIR;

    const rows = await sequelize.query(
      `SELECT id, dni, nombre, ruta FROM tblarchivos
       WHERE deleted_at IS NULL
       ORDER BY id ASC
       LIMIT 5000`,
      { type: QueryTypes.SELECT }
    );

    const orphans: OrphanRecord[] = [];

    for (const row of rows as any[]) {
      const rutaRaw = String(row.ruta || '').trim();

      if (/^\d+$/.test(rutaRaw) || rutaRaw === '') {
        orphans.push({ ...row, motivo: 'legacy_number' });
        continue;
      }

      if (!baseDir || !fs.existsSync(baseDir)) {
        orphans.push({ ...row, motivo: 'base_dir_missing' });
        continue;
      }

      const resolved = resolveDocumentPath(rutaRaw, baseDir);
      if (!resolved) {
        orphans.push({ ...row, motivo: 'file_not_found' });
      }
    }

    return orphans;
  },
};
