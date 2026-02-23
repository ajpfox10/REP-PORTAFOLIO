/**
 * @file domains/personalv5/schemas/document.schema.ts
 *
 * Esquemas Zod para validar TODOS los inputs relacionados a documentos.
 * Si el input no pasa el schema, la request se rechaza con 400 ANTES de
 * tocar la base de datos. Esto evita queries innecesarias y errores crípticos.
 */

import { z } from 'zod';

export const uploadDocumentSchema = z.object({
  dni:         z.coerce.number().int().positive('DNI debe ser un número positivo'),
  nombre:      z.string().max(255).optional(),
  numero:      z.string().max(100).optional(),
  tipo:        z.string().max(100).optional(),
  descripcion: z.string().max(1000).optional(),
  // categoria: carpeta lógica del documento. Ej: "RESOLUCIONES Y VARIOS", "EXPTES"
  // Permite organizar los archivos en subdirectorios de DOCUMENTS_BASE_DIR
  categoria:   z.string().max(200).optional(),
});

export const listDocumentsSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q:     z.string().max(200).optional(),
  dni:   z.coerce.number().int().positive().optional(),
  tipo:  z.string().max(100).optional(),
});

export const documentIdSchema = z.object({
  id: z.coerce.number().int().positive('ID debe ser un número positivo'),
});

export type UploadDocumentDto   = z.infer<typeof uploadDocumentSchema>;
export type ListDocumentsDto    = z.infer<typeof listDocumentsSchema>;
export type DocumentIdDto       = z.infer<typeof documentIdSchema>;
