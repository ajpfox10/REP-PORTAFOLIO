// src/services/documentVersion.service.ts
import { Sequelize } from 'sequelize';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { sniffFileMagic } from '../files/mimeSniffer';
import { resolveSafeRealPath } from '../files/fileSecurity';

export interface VersionInfo {
  id: number;
  version: number;
  filename: string;
  nombre_original: string;
  tamanio: number;
  mime_type: string;
  metadata: any;
  created_at: Date;
  created_by: number | null;
}

export async function createVersion(
  sequelize: Sequelize,
  documentoId: number,
  filePath: string,
  originalName: string,
  createdBy: number | null,
  metadata?: any
): Promise<VersionInfo> {
  try {
    // 1. Obtener versión actual máxima
    const [versionRows] = await sequelize.query(
      `SELECT MAX(version) as max_version 
       FROM documentos_versiones 
       WHERE documento_id = :documentoId AND deleted_at IS NULL`,
      { replacements: { documentoId } }
    );

    const currentVersion = (versionRows as any[])[0]?.max_version || 0;
    const newVersion = currentVersion + 1;

    // 2. Detectar MIME type
    const sniff = sniffFileMagic(filePath);
    const stats = fs.statSync(filePath);
    const ext = path.extname(originalName);

    // 3. Nombre único para el archivo en disco
    const timestamp = Date.now();
    const fileName = `${timestamp}_v${newVersion}_${documentoId}${ext}`;
    
    const year = new Date().getFullYear();
    const destDir = path.join(env.DOCUMENTS_BASE_DIR, 'versiones', String(year));
    
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const destPath = path.join(destDir, fileName);

    // 4. Mover/copiar archivo
    fs.copyFileSync(filePath, destPath);

    // 5. Insertar versión
    const [result] = await sequelize.query(
      `INSERT INTO documentos_versiones 
       (documento_id, version, filename, nombre_original, tamanio, mime_type, metadata, created_by, created_at)
       VALUES
       (:documentoId, :version, :filename, :nombreOriginal, :tamanio, :mimeType, :metadata, :createdBy, NOW())`,
      {
        replacements: {
          documentoId,
          version: newVersion,
          filename: fileName,
          nombreOriginal: originalName,
          tamanio: stats.size,
          mimeType: sniff.mime || 'application/octet-stream',
          metadata: metadata ? JSON.stringify(metadata) : null,
          createdBy
        }
      }
    );

    const insertId = (result as any).insertId;

    // 6. Obtener versión creada
    const [newRows] = await sequelize.query(
      `SELECT 
        id, version, filename, nombre_original, tamanio, mime_type, metadata, created_at, created_by
       FROM documentos_versiones 
       WHERE id = :id LIMIT 1`,
      { replacements: { id: insertId } }
    );

    logger.info({ 
      msg: 'Document version created', 
      documentoId, 
      version: newVersion,
      file: fileName 
    });

    return (newRows as any[])[0];

  } catch (err) {
    logger.error({ msg: 'Error creating document version', documentoId, err });
    throw err;
  }
}

export async function getVersions(
  sequelize: Sequelize,
  documentoId: number,
  limit: number = 50,
  offset: number = 0
): Promise<{ versions: VersionInfo[]; total: number }> {
  try {
    const [rows] = await sequelize.query(
      `SELECT 
        id, version, filename, nombre_original, tamanio, mime_type, metadata, created_at, created_by
       FROM documentos_versiones
       WHERE documento_id = :documentoId AND deleted_at IS NULL
       ORDER BY version DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: { documentoId, limit, offset } }
    );

    const [countRows] = await sequelize.query(
      `SELECT COUNT(1) as total
       FROM documentos_versiones
       WHERE documento_id = :documentoId AND deleted_at IS NULL`,
      { replacements: { documentoId } }
    );

    const total = (countRows as any[])[0]?.total || 0;

    return {
      versions: rows as VersionInfo[],
      total
    };
  } catch (err) {
    logger.error({ msg: 'Error getting document versions', documentoId, err });
    throw err;
  }
}

export async function getVersionFile(
  sequelize: Sequelize,
  documentoId: number,
  version: number
): Promise<{ filePath: string; versionInfo: VersionInfo }> {
  try {
    const [rows] = await sequelize.query(
      `SELECT 
        id, version, filename, nombre_original, tamanio, mime_type, metadata
       FROM documentos_versiones
       WHERE documento_id = :documentoId AND version = :version AND deleted_at IS NULL
       LIMIT 1`,
      { replacements: { documentoId, version } }
    );

    const versionInfo = (rows as any[])[0];
    if (!versionInfo) {
      throw new Error('Version not found');
    }

    // Buscar el archivo en los directorios de versiones por año
    const years = [new Date().getFullYear(), new Date().getFullYear() - 1];
    let filePath: string | null = null;

    for (const year of years) {
      const candidate = path.join(
        env.DOCUMENTS_BASE_DIR,
        'versiones',
        String(year),
        versionInfo.filename
      );
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }

    if (!filePath) {
      throw new Error('Version file not found on disk');
    }

    return { filePath, versionInfo };
  } catch (err) {
    logger.error({ msg: 'Error getting version file', documentoId, version, err });
    throw err;
  }
}