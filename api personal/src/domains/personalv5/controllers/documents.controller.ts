/**
 * @file domains/personalv5/controllers/documents.controller.ts
 *
 * Controller de documentos: recibe el request de Express, valida con Zod,
 * llama al servicio, devuelve la respuesta.
 *
 * NO tiene lógica de negocio. Solo orquesta.
 */

import { Request, Response } from 'express';
import fs from 'fs';
import { listDocumentsSchema, uploadDocumentSchema } from '../schemas';
import { DocumentsService } from '../services/documents.service';
import { logger } from '../../../logging/logger';
import { cacheMiddleware } from '../../../infra/cache';

// ── LIST ──────────────────────────────────────────────────────────────────────

export async function listDocuments(req: Request, res: Response): Promise<void> {
  const parsed = listDocumentsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Parámetros inválidos', details: parsed.error.issues });
    return;
  }

  const sequelize = (req as any).sequelize ?? (req.app.locals as any).sequelize;
  const { data, total } = await DocumentsService.list(sequelize, parsed.data);

  res.json({
    ok: true,
    data,
    page:  parsed.data.page,
    limit: parsed.data.limit,
    total,
  });
}

// ── DOWNLOAD FILE ─────────────────────────────────────────────────────────────

export async function downloadFile(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ ok: false, error: 'ID de documento inválido' });
    return;
  }

  const sequelize = (req as any).sequelize ?? (req.app.locals as any).sequelize;

  let docFile;
  try {
    docFile = await DocumentsService.resolveFile(sequelize, id);
  } catch (err: any) {
    res.status(err.status ?? 404).json({
      ok:      false,
      error:   err.message,
      code:    err.code,
      docId:   id,
      details: err.code === 'LEGACY_NO_FILE'
        ? 'El administrador debe volver a subir el archivo para este documento histórico.'
        : 'Verificar que DOCUMENTS_BASE_DIR apunte a D:\\G (no a D:\\G\\DOCU ni otra subcarpeta)',
    });
    return;
  }

  (res.locals as any).audit = {
    action:        'documents_download',
    table_name:    'tblarchivos',
    record_pk:     id,
    entity_table:  'tblarchivos',
    entity_pk:     id,
    request_json:  { id, mime: docFile.mime, size: docFile.stat.size },
    response_json: { status: 200 },
  };

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.setHeader('Content-Type', docFile.mime);
  res.setHeader('Content-Disposition', `inline; filename="${docFile.filename}"`);
  res.setHeader('Content-Length', String(docFile.stat.size));

  const stream = fs.createReadStream(docFile.fullPath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'Error al leer el archivo' });
  });
  stream.pipe(res);
}

// ── UPLOAD ────────────────────────────────────────────────────────────────────

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ ok: false, error: 'No se envió ningún archivo' });
    return;
  }

  const parsed = uploadDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    // Limpiar el archivo temporal si hay error de validación
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.issues });
    return;
  }

  const sequelize = (req as any).sequelize ?? (req.app.locals as any).sequelize;
  const actor     = (req as any).auth?.principalId ?? null;

  try {
    const result = await DocumentsService.upload(sequelize, {
      dni:          Number(parsed.data.dni),
      filePath:     req.file.path,
      originalName: req.file.originalname,
      fileSize:     req.file.size,
      mimeType:     req.file.mimetype,
      nombre:       parsed.data.nombre,
      numero:       parsed.data.numero,
      tipo:         parsed.data.tipo,
      descripcion:  parsed.data.descripcion,
      actor,
    });

    (res.locals as any).audit = {
      action:        'documents_upload',
      table_name:    'tblarchivos',
      record_pk:     result.id,
      entity_table:  'tblarchivos',
      entity_pk:     result.id,
      request_json:  { dni: result.dni, filename: result.filename },
      response_json: { status: 201, id: result.id },
    };

    res.status(201).json({ ok: true, data: result });

  } catch (err: any) {
    // Limpiar archivo temporal si algo falló
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    logger.error({ msg: '[documents] upload falló', err: err?.message });
    res.status(err.status || 500).json({ ok: false, error: err.message || 'Error al subir' });
  }
}

// ── ORPHANS ───────────────────────────────────────────────────────────────────

export async function listOrphans(req: Request, res: Response): Promise<void> {
  const sequelize = (req as any).sequelize ?? (req.app.locals as any).sequelize;
  const orphans   = await DocumentsService.listOrphans(sequelize);

  res.json({
    ok:    true,
    total: orphans.length,
    data:  orphans,
    hint:  'Estos registros no tienen archivo físico disponible. ' +
           'Verificar que DOCUMENTS_BASE_DIR = D:\\G (raíz con todas las subcarpetas).',
  });
}
