/**
 * @file domains/personalv5/services/document.service.ts
 * @description Logica de negocio para documentos y archivos fisicos.
 *
 * Este servicio resuelve el problema central de los documentos:
 * la BD tiene distintos formatos de ruta segun cuando fue cargado el archivo.
 * Hay 4 formatos historicos:
 *
 *   1. Numero puro ("3", "127")      → ID del sistema viejo, sin archivo fisico
 *   2. Windows absoluta ("D:\G\RESOLUCIONES Y VARIOS\archivo.pdf")  → nuevo sistema (relativa al base dir)
 *   3. Relativa nueva ("2025/archivo.pdf")   → subida desde la app, formato moderno
 *   4. Solo nombre ("archivo.pdf")           → buscar por nombre en todo el arbol
 *
 * El DOCUMENTS_BASE_DIR en .env = "D:\G\DOCUMENTOS Y VARIOS"
 * Los archivos estan en esa carpeta y sus subcarpetas.
 *
 * RESOLUCION: si la ruta en BD empieza con DOCUMENTS_BASE_DIR, se strip ese prefijo
 * y se usa el resto como ruta relativa. Asi "D:\G\RESOLUCIONES Y VARIOS\archivo.pdf"
 * se convierte en "RESOLUCIONES Y VARIOS\archivo.pdf" y se busca desde D:\G.
 */

import fs from 'fs';
import path from 'path';
import { Sequelize, QueryTypes } from 'sequelize';
import { env } from '../../../config/env';
import { resolveSafeRealPath, validateDownloadFile, FileSecurityError } from '../../../files/fileSecurity';
import { scanFileOrThrow } from '../../../files/fileScanner';
import { invalidate, documentTags } from '../../../infra/invalidateOnWrite';
import { logger } from '../../../logging/logger';
import { cacheInvalidateTags } from '../../../infra/cache';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface DocumentRow {
  id: number;
  dni: number;
  ruta: string;
  nombre: string;
  nombre_archivo_original: string;
  tipo?: string;
  numero?: string;
  fecha?: string;
  tamanio?: string;
  anio?: number;
}

export interface ResolvedFile {
  fullPath: string;
  stat: fs.Stats;
  mime: string;
  ext: string;
  filename: string;
}

// ─── DocumentService ──────────────────────────────────────────────────────────

export class DocumentService {
  private readonly baseDir: string;
  private readonly scanDir: string;

  constructor(private readonly sequelize: Sequelize) {
    this.baseDir = env.DOCUMENTS_BASE_DIR;
    this.scanDir = (env as any).DOCUMENTS_SCAN_DIR?.trim() || '';
  }

  /**
   * Busca un documento en la BD por ID.
   */
  async findById(id: number): Promise<DocumentRow | null> {
    const rows = await this.sequelize.query<DocumentRow>(
      `SELECT id, dni, ruta, nombre, nombre_archivo_original, tipo, numero, fecha, tamanio, anio
       FROM tblarchivos WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    return rows[0] || null;
  }

  /**
   * Resuelve la ruta fisica de un documento a partir del registro en BD.
   * Este es el corazon del sistema de documentos.
   *
   * Estrategia de resolucion (en orden):
   *   1. Si ruta es numero puro → legacy sin archivo → error descriptivo
   *   2. Si ruta es absoluta Windows (contiene ":") → hacerla relativa al baseDir
   *   3. Si ruta tiene "/" o "\" → usarla como relativa al baseDir
   *   4. Si falla todo → buscar por nombre de archivo en el arbol de directorios
   */
  async resolveFile(doc: DocumentRow): Promise<ResolvedFile> {
    const rutaRaw = String(doc.ruta || '').trim();
    const nombreOriginal = String(doc.nombre_archivo_original || doc.nombre || '').trim();

    // Caso 1: Registro legacy (solo un numero) - no hay archivo fisico
    if (/^\d+$/.test(rutaRaw) || rutaRaw === '') {
      throw Object.assign(
        new Error('Documento historico sin archivo digital. El administrador debe volver a subir el archivo.'),
        { status: 404, code: 'LEGACY_NO_FILE', id: doc.id }
      );
    }

    // Intentar resolver usando distintas estrategias
    let fullPath: string | null = null;

    // Estrategia 2 y 3: normalizar la ruta contra DOCUMENTS_BASE_DIR
    fullPath = this.tryResolvePath(rutaRaw, this.baseDir);

    // Si no encontró, intentar contra DOCUMENTS_SCAN_DIR (carpeta del escáner)
    if (!fullPath && this.scanDir) {
      fullPath = this.tryResolvePath(rutaRaw, this.scanDir);
    }

    // Si no, buscar por nombre de archivo en el arbol de directorios (ambos dirs)
    if (!fullPath && nombreOriginal) {
      fullPath = this.searchByFilename(nombreOriginal, this.baseDir);
      if (!fullPath && this.scanDir) {
        fullPath = this.searchByFilename(nombreOriginal, this.scanDir);
      }
    }

    if (!fullPath) {
      logger.warn({ msg: 'Archivo no encontrado', id: doc.id, ruta: rutaRaw, base: this.baseDir });
      throw Object.assign(
        new Error('Archivo no encontrado en el servidor. Verifica que DOCUMENTS_BASE_DIR este configurado correctamente.'),
        { status: 404, code: 'FILE_NOT_FOUND', ruta: rutaRaw }
      );
    }

    // Validar: existe, no es directorio, MIME permitido, tamano maximo
    const { stat, sniff } = validateDownloadFile(fullPath);

    // Antivirus (si esta configurado)
    await scanFileOrThrow(fullPath);

    const nameFromDb = this.safeFilename(doc.nombre_archivo_original || doc.nombre || `doc-${doc.id}`);
    const filename = nameFromDb.includes('.') ? nameFromDb : `${nameFromDb}.${sniff.ext || 'bin'}`;

    return { fullPath, stat, mime: sniff.mime, ext: sniff.ext, filename };
  }

  /**
   * Lista documentos con paginacion y filtros.
   * El resultado se puede cachear con tag "documents:list" o "documents:dni:{dni}".
   */
  async list(opts: {
    page?: number;
    limit?: number;
    q?: string;
    dni?: number;
  }): Promise<{ data: DocumentRow[]; total: number; page: number; limit: number }> {
    const page  = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 50));
    const offset = (page - 1) * limit;

    let where = 'deleted_at IS NULL';
    const reps: any = { limit, offset };

    if (opts.q) {
      where += ' AND (nombre LIKE :q OR tipo LIKE :q OR nombre_archivo_original LIKE :q)';
      reps.q = `%${opts.q}%`;
    }
    if (opts.dni) {
      where += ' AND dni = :dni';
      reps.dni = opts.dni;
    }

    const [rows, countRows] = await Promise.all([
      this.sequelize.query<DocumentRow>(
        `SELECT id, dni, nombre, tipo, numero, fecha, tamanio, anio, descripcion_archivo,
                nombre_archivo_original, ruta, created_at
         FROM tblarchivos WHERE ${where} ORDER BY id DESC LIMIT :limit OFFSET :offset`,
        { replacements: reps, type: QueryTypes.SELECT }
      ),
      this.sequelize.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM tblarchivos WHERE ${where}`,
        { replacements: reps, type: QueryTypes.SELECT }
      ),
    ]);

    const total = countRows[0]?.total ?? 0;
    const data = rows.map((r) => ({
      ...r,
      fileUrl: `/api/v1/documents/${r.id}/file`,
    }));

    return { data: data as any, total, page, limit };
  }

  /**
   * Soft-delete de un documento.
   * Invalida el cache del documento y el del agente.
   */
  async softDelete(id: number, userId: number): Promise<void> {
    const doc = await this.findById(id);
    if (!doc) throw Object.assign(new Error('Documento no encontrado.'), { status: 404 });

    await this.sequelize.query(
      `UPDATE tblarchivos SET deleted_at = NOW(), deleted_by = :userId WHERE id = :id`,
      { replacements: { id, userId } }
    );

    // Invalida cache: el documento especifico + todos los docs del agente + el listado
    await invalidate(documentTags.all(id, doc.dni), 'document.delete');
  }

  // ─── Helpers privados ────────────────────────────────────────────────────

  /**
   * Intenta resolver una ruta (absoluta o relativa) de forma segura.
   * Maneja rutas Windows (D:\G\...) en servidor Windows.
   * Retorna null si el archivo no existe o no es seguro.
   */
  private tryResolvePath(ruta: string, baseDir: string): string | null {
    if (!ruta || !baseDir) return null;

    const normalized = ruta.replace(/\\/g, '/');
    const baseNorm = baseDir.replace(/\\/g, '/');

    let relative: string;

    if (normalized.includes(':')) {
      // Ruta Windows absoluta tipo "D:/G/RESOLUCIONES Y VARIOS/archivo.pdf"
      // Quitamos el prefijo del baseDir para obtener la parte relativa
      if (normalized.toLowerCase().startsWith(baseNorm.toLowerCase())) {
        // Ej: "D:/G/RESOLUCIONES Y VARIOS/archivo.pdf" → "RESOLUCIONES Y VARIOS/archivo.pdf"
        relative = normalized.slice(baseNorm.length).replace(/^[\\/]+/, '');
      } else {
        // Ruta absoluta fuera del baseDir: tomar los ultimos 2 segmentos
        const parts = normalized.split('/').filter(Boolean);
        relative = parts.slice(-2).join('/');
      }
    } else {
      // Ya es relativa: "2025/archivo.pdf" o "RESOLUCIONES Y VARIOS/archivo.pdf"
      relative = normalized;
    }

    if (!relative) return null;

    try {
      return resolveSafeRealPath(baseDir, relative);
    } catch {
      // Probar solo el nombre del archivo si el path completo falla
      const filename = relative.split('/').pop();
      if (filename && filename !== relative) {
        try { return resolveSafeRealPath(baseDir, filename); } catch {}
      }
      return null;
    }
  }

  /**
   * Busca un archivo por nombre en todo el arbol de directorios del baseDir.
   * Util cuando solo tenemos el nombre del archivo sin saber en que carpeta esta.
   * Busca hasta 2 niveles de profundidad: baseDir/subdir/filename y baseDir/filename.
   */
  private searchByFilename(filename: string, baseDir: string): string | null {
    if (!filename || !baseDir || !fs.existsSync(baseDir)) return null;

    try {
      // Nivel 0: directamente en el baseDir
      const direct = path.join(baseDir, filename);
      if (fs.existsSync(direct)) return direct;

      // Nivel 1: en subdirectorios directos
      const subdirs = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const subdir of subdirs) {
        const candidate = path.join(baseDir, subdir, filename);
        if (fs.existsSync(candidate)) return candidate;

        // Nivel 2: cualquier subdirectorio dentro de cada subdir (años, tenants, etc.)
        try {
          const innerDirs = fs.readdirSync(path.join(baseDir, subdir), { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
          for (const inner of innerDirs) {
            const innerCandidate = path.join(baseDir, subdir, inner, filename);
            if (fs.existsSync(innerCandidate)) return innerCandidate;
          }
        } catch {}
      }
    } catch (err: any) {
      logger.debug({ msg: 'searchByFilename error', filename, baseDir, err: err?.message });
    }

    return null;
  }

  private safeFilename(name: string): string {
    return String(name || 'document')
      .replace(/[\\/]/g, '_')
      .replace(/[\r\n"]/g, '_')
      .trim() || 'document';
  }
}
