/**
 * @file domains/personalv5/schemas/index.ts
 *
 * Todos los schemas de validación del dominio PersonalV5.
 *
 * Zod en TODOS los endpoints = errores 400 claros antes de tocar la BD.
 * Los schemas se usan tanto en controllers como en services para tipado fuerte.
 */

import { z } from 'zod';

// ── AUTH ──────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email:    z.string().email('Email inválido'),
  password: z.string().min(1, 'Contraseña requerida'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token:    z.string().min(1),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

export const requestAccessSchema = z.object({
  nombre: z.string().min(2, 'Nombre requerido').max(120),
  email:  z.string().email('Email inválido'),
  cargo:  z.string().max(150).optional(),
  motivo: z.string().max(500).optional(),
});

export const confirmCodeSchema = z.object({
  email:  z.string().email(),
  codigo: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos'),
});

// ── PERSONAL / AGENTES ────────────────────────────────────────────────────────

export const altaAgenteSchema = z.object({
  // PERSONAL
  dni:                z.number().int().positive('DNI inválido'),
  apellido:           z.string().min(1).max(100),
  nombre:             z.string().min(1).max(100),
  cuil:               z.string().max(20).optional(),
  fecha_nacimiento:   z.string().optional(),
  sexo_id:            z.number().int().optional(),
  estado_civil:       z.string().max(30).optional(),
  email:              z.string().email().optional().or(z.literal('')),
  telefono:           z.string().max(30).optional(),
  domicilio:          z.string().max(255).optional(),
  localidad_id:       z.number().int().optional(),

  // AGENTES
  ley_id:             z.number().int().optional(),
  planta_id:          z.number().int().optional(),
  categoria_id:       z.number().int().optional(),
  funcion_id:         z.number().int().optional(),
  ocupacion_id:       z.number().int().optional(),
  regimen_horario_id: z.number().int().optional(),
  jefatura_id:        z.number().int().optional(),
  sector_id:          z.number().int().optional(),
  dependencia_id:     z.number().int().optional(),
  fecha_ingreso:      z.string().optional(),
  fecha_egreso:       z.string().optional(),
  estado:             z.enum(['ACTIVO', 'INACTIVO', 'LICENCIA']).default('ACTIVO'),

  // SERVICIOS
  servicios: z.array(z.object({
    servicio_id:  z.number().int().positive(),
    fecha_desde:  z.string().optional(),
    fecha_hasta:  z.string().optional(),
    observaciones: z.string().max(500).optional(),
  })).optional(),
});

export type AltaAgenteInput = z.infer<typeof altaAgenteSchema>;

// ── DOCUMENTOS ────────────────────────────────────────────────────────────────

export const uploadDocumentSchema = z.object({
  dni:         z.string().regex(/^\d+$/, 'DNI debe ser numérico'),
  nombre:      z.string().max(255).optional(),
  numero:      z.string().max(50).optional(),
  tipo:        z.string().max(100).optional(),
  descripcion: z.string().max(1000).optional(),
});

export const listDocumentsSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q:     z.string().optional(),
  dni:   z.coerce.number().int().optional(),
});

// ── EVENTOS ───────────────────────────────────────────────────────────────────

export const eventoSchema = z.object({
  dni:          z.number().int().positive(),
  tipo:         z.enum(['LICENCIA', 'CITACION', 'SANCION']),
  estado:       z.enum(['ABIERTO', 'CERRADO', 'PENDIENTE']).default('ABIERTO'),
  fecha_inicio: z.string().optional(),
  fecha_fin:    z.string().optional(),
  titulo:       z.string().max(255).optional(),
  descripcion:  z.string().optional(),
  metadata:     z.any().optional(),
});

export const cerrarEventoSchema = z.object({
  estado:        z.enum(['CERRADO', 'FINALIZADO']).default('CERRADO'),
  observaciones: z.string().optional(),
});

// ── CERTIFICADOS ──────────────────────────────────────────────────────────────

export const certificadoSchema = z.object({
  dni:           z.number().int().positive(),
  tipo:          z.string().min(1),
  datos_extra:   z.record(z.any()).optional(),
});

// ── CUMPLEAÑOS ────────────────────────────────────────────────────────────────

export const cumpleanosSchema = z.object({
  mes:   z.coerce.number().int().min(1).max(12).optional(),
  dia:   z.coerce.number().int().min(1).max(31).optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
});
