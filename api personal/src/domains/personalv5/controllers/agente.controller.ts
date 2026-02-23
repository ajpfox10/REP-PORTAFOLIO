/**
 * @file domains/personalv5/controllers/agente.controller.ts
 * @description Controller de agentes: endpoint de alta atomica y actualizacion.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { AgenteService } from '../services/agente.service';

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

const altaAgenteSchema = z.object({
  // Datos personales (obligatorios)
  dni:             z.number().int().positive('DNI debe ser un numero positivo'),
  apellido:        z.string().min(1).max(100).trim(),
  nombre:          z.string().min(1).max(100).trim(),
  // Datos personales (opcionales)
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sexo_id:         z.number().int().positive().optional(),
  cuil:            z.string().max(15).optional(),
  email:           z.string().email().optional().or(z.literal('')),
  telefono:        z.string().max(30).optional(),
  domicilio:       z.string().max(200).optional(),
  localidad_id:    z.number().int().positive().optional(),
  // Datos laborales (opcionales)
  ley_id:           z.number().int().positive().optional(),
  planta_id:        z.number().int().positive().optional(),
  categoria_id:     z.number().int().positive().optional(),
  funcion_id:       z.number().int().positive().optional(),
  ocupacion_id:     z.number().int().positive().optional(),
  regimen_horario_id: z.number().int().positive().optional(),
  jefatura_id:      z.number().int().positive().optional(),
  sector_id:        z.number().int().positive().optional(),
  dependencia_id:   z.number().int().positive().optional(),
  fecha_ingreso:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fecha_alta:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Servicios
  servicios: z.array(z.object({
    servicio_id: z.number().int().positive(),
    fecha_desde: z.string().optional(),
    fecha_hasta: z.string().optional(),
  })).optional(),
});

// ─── Controller ───────────────────────────────────────────────────────────────

export class AgenteController {
  constructor(private readonly service: AgenteService) {}

  /**
   * POST /api/v1/agentes/alta
   * Alta atomica: crea personal + agentes + servicios en una transaccion.
   */
  alta = async (req: Request, res: Response): Promise<void> => {
    const parsed = altaAgenteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    try {
      const actor = (req as any).auth?.principalId ?? undefined;
      const result = await this.service.alta({ ...parsed.data, actor });

      (res.locals as any).audit = {
        action: 'agente_alta',
        table_name: 'personal',
        record_pk: result.dni,
        request_json: { dni: result.dni },
        response_json: { status: 201, agenteId: result.agenteId },
      };

      res.status(201).json({ ok: true, data: result });
    } catch (err: any) {
      res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al crear agente' });
    }
  };

  /**
   * GET /api/v1/agentes/dni/:dni
   * Busca un agente completo por DNI.
   */
  findByDni = async (req: Request, res: Response): Promise<void> => {
    const dni = parseInt(req.params.dni, 10);
    if (!dni || isNaN(dni)) {
      res.status(400).json({ ok: false, error: 'DNI invalido' });
      return;
    }
    try {
      const agente = await this.service.findByDni(dni);
      if (!agente) {
        res.status(404).json({ ok: false, error: `Agente DNI ${dni} no encontrado` });
        return;
      }
      res.json({ ok: true, data: agente });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  };

  /**
   * PATCH /api/v1/agentes-v2/:dni
   * Actualización parcial de datos laborales del agente.
   */
  patch = async (req: Request, res: Response): Promise<void> => {
    const dni = parseInt(req.params.dni, 10);
    if (!dni || isNaN(dni)) {
      res.status(400).json({ ok: false, error: 'DNI inválido' });
      return;
    }

    const patchSchema = z.object({
      ley_id:             z.number().int().positive().optional(),
      planta_id:          z.number().int().positive().optional(),
      categoria_id:       z.number().int().positive().optional(),
      funcion_id:         z.number().int().positive().optional(),
      ocupacion_id:       z.number().int().positive().optional(),
      regimen_horario_id: z.number().int().positive().optional(),
      sector_id:          z.number().int().positive().optional(),
      dependencia_id:     z.number().int().positive().optional(),
      fecha_ingreso:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      fecha_egreso:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      estado:             z.string().max(50).optional(),
    }).strict();

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    try {
      await this.service.patch(dni, parsed.data);
      res.json({ ok: true, message: `Agente DNI ${dni} actualizado` });
    } catch (err: any) {
      res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al actualizar' });
    }
  };
}
