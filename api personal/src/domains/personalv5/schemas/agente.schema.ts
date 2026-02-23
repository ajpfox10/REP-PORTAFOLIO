/**
 * @file domains/personalv5/schemas/agente.schema.ts
 *
 * Schemas Zod para la creación y edición de agentes.
 * El schema "altaAgenteSchema" valida el payload completo del alta atómica:
 * personal + agente + servicios en una sola operación (una transacción DB).
 */

import { z } from 'zod';

// ─── Personal (tabla: personal) ───────────────────────────────────────────────
export const personalSchema = z.object({
  dni:             z.number().int().positive(),
  apellido:        z.string().max(100),
  nombre:          z.string().max(100),
  cuil:            z.string().max(20).optional(),
  fecha_nacimiento:z.string().optional(), // ISO date string
  sexo_id:         z.number().int().positive().optional(),
  email:           z.string().email().optional(),
  telefono:        z.string().max(30).optional(),
  domicilio:       z.string().max(255).optional(),
  localidad_id:    z.number().int().positive().optional(),
});

// ─── Agente (tabla: agentes) ──────────────────────────────────────────────────
export const agenteSchema = z.object({
  ley_id:           z.number().int().positive().optional(),
  planta_id:        z.number().int().positive().optional(),
  categoria_id:     z.number().int().positive().optional(),
  funcion_id:       z.number().int().positive().optional(),
  ocupacion_id:     z.number().int().positive().optional(),
  regimen_horario_id:z.number().int().positive().optional(),
  jefatura_id:      z.number().int().positive().optional(),
  sector_id:        z.number().int().positive().optional(),
  dependencia_id:   z.number().int().positive().optional(),
  fecha_ingreso:    z.string().optional(),
  estado:           z.enum(['activo','inactivo','licencia','baja']).default('activo'),
});

// ─── Alta completa (atómica) ──────────────────────────────────────────────────
// POST /api/v1/agentes/alta usa este schema.
// Un solo llamado → una transacción → personal + agente + servicios o nada.
export const altaAgenteSchema = z.object({
  personal:  personalSchema,
  agente:    agenteSchema.optional(),
  servicios: z.array(z.object({
    servicio_id: z.number().int().positive(),
    desde:       z.string().optional(),
    hasta:       z.string().optional(),
    observacion: z.string().max(500).optional(),
  })).optional(),
});

export type PersonalDto   = z.infer<typeof personalSchema>;
export type AgenteDto     = z.infer<typeof agenteSchema>;
export type AltaAgenteDto = z.infer<typeof altaAgenteSchema>;
