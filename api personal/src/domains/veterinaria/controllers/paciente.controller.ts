/**
 * @file domains/veterinaria/controllers/paciente.controller.ts
 * @description Controller de pacientes veterinarios.
 * Mismo patron que personalv5: delgado, solo valida input y llama al service.
 */
import { Request, Response } from 'express';
import { z } from 'zod';
import { PacienteService } from '../services/paciente.service';

const crearSchema = z.object({
  nombre: z.string().min(1).max(100),
  especie: z.enum(['Perro', 'Gato', 'Ave', 'Reptil', 'Roedor', 'Conejo', 'Otro']),
  raza: z.string().max(100).optional(),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sexo: z.enum(['M', 'F']).optional(),
  castrado: z.boolean().optional(),
  observaciones: z.string().max(1000).optional(),
  dueno_nombre: z.string().min(1).max(150),
  dueno_telefono: z.string().max(30).optional(),
  dueno_email: z.string().email().optional().or(z.literal('')),
});

export class PacienteController {
  constructor(private readonly service: PacienteService) {}

  list = async (req: Request, res: Response) => {
    try {
      const result = await this.service.findAll({
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
        especie: req.query.especie as string | undefined,
      });
      res.json({ ok: true, ...result });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message }); }
  };

  getById = async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'ID invalido' }); return; }
    try {
      const p = await this.service.findById(id);
      if (!p) { res.status(404).json({ ok: false, error: 'Paciente no encontrado' }); return; }
      res.json({ ok: true, data: p });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message }); }
  };

  create = async (req: Request, res: Response) => {
    const parsed = crearSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.flatten() }); return; }
    try {
      const actor = (req as any).auth?.principalId;
      const result = await this.service.create({ ...parsed.data, actor });
      res.status(201).json({ ok: true, data: result });
    } catch (err: any) { res.status(err?.status || 500).json({ ok: false, error: err?.message }); }
  };

  update = async (req: Request, res: Response) => {
    res.status(501).json({ ok: false, error: 'No implementado aun' });
  };

  historial = async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    try {
      const data = await this.service.getHistorial(id);
      res.json({ ok: true, data });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message }); }
  };

  addVacuna = async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const { vacuna_nombre, fecha_aplicacion, fecha_proxima } = req.body;
    if (!vacuna_nombre || !fecha_aplicacion) { res.status(400).json({ ok: false, error: 'vacuna_nombre y fecha_aplicacion son requeridos' }); return; }
    try {
      await this.service.addVacuna({ paciente_id: id, vacuna_nombre, fecha_aplicacion, fecha_proxima });
      res.status(201).json({ ok: true });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message }); }
  };

  internar = async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const { motivo } = req.body;
    if (!motivo) { res.status(400).json({ ok: false, error: 'motivo es requerido' }); return; }
    try {
      await this.service.internar(id, motivo);
      res.status(201).json({ ok: true });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message }); }
  };
}
