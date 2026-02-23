/**
 * @file domains/veterinaria/services/paciente.service.ts
 * @description Logica de negocio para pacientes veterinarios.
 * Mismo patron que personalv5: servicio puro, sin Express, testeable.
 */
import { Sequelize, QueryTypes } from 'sequelize';
import { invalidate } from '../../../infra/invalidateOnWrite';
import { logger } from '../../../logging/logger';

const pacienteTags = {
  byId: (id: number | string) => `paciente:${id}`,
  list: () => 'pacientes:list',
};

export interface CrearPacienteDto {
  nombre: string; especie: string; raza?: string;
  fecha_nacimiento?: string; sexo?: 'M' | 'F'; castrado?: boolean;
  observaciones?: string;
  dueno_nombre: string; dueno_telefono?: string; dueno_email?: string;
  actor?: number;
}

export class PacienteService {
  constructor(private readonly sequelize: Sequelize) {}

  async create(dto: CrearPacienteDto): Promise<{ id: number }> {
    const t = await this.sequelize.transaction();
    try {
      let duenos = await this.sequelize.query<{ id: number }>(
        `SELECT id FROM duenos WHERE email = :email LIMIT 1`,
        { replacements: { email: dto.dueno_email || '' }, type: QueryTypes.SELECT, transaction: t }
      );
      let duenoId: number;
      if (duenos.length > 0) { duenoId = duenos[0].id; }
      else {
        const [r]: any = await this.sequelize.query(
          `INSERT INTO duenos (nombre, telefono, email, created_at) VALUES (:nombre, :telefono, :email, NOW())`,
          { replacements: { nombre: dto.dueno_nombre, telefono: dto.dueno_telefono || null, email: dto.dueno_email || null }, transaction: t }
        );
        duenoId = r.insertId;
      }
      const [result]: any = await this.sequelize.query(
        `INSERT INTO pacientes (nombre, especie, raza, fecha_nacimiento, sexo, castrado, observaciones, dueno_id, created_by, created_at)
         VALUES (:nombre, :especie, :raza, :fecha_nacimiento, :sexo, :castrado, :obs, :dueno_id, :actor, NOW())`,
        { replacements: { nombre: dto.nombre, especie: dto.especie, raza: dto.raza || null,
          fecha_nacimiento: dto.fecha_nacimiento || null, sexo: dto.sexo || null,
          castrado: dto.castrado ? 1 : 0, obs: dto.observaciones || null, dueno_id: duenoId, actor: dto.actor || null }, transaction: t }
      );
      await t.commit();
      await invalidate(pacienteTags.list(), 'paciente.create');
      return { id: result.insertId };
    } catch (err) { await t.rollback(); throw err; }
  }

  async findAll(opts: { page?: number; limit?: number; especie?: string }): Promise<any> {
    const page = Math.max(1, opts.page || 1), limit = Math.min(100, opts.limit || 20), offset = (page-1)*limit;
    let where = '1=1'; const reps: any = { limit, offset };
    if (opts.especie) { where += ' AND p.especie = :especie'; reps.especie = opts.especie; }
    const rows = await this.sequelize.query(
      `SELECT p.*, d.nombre as dueno_nombre, d.telefono as dueno_telefono FROM pacientes p LEFT JOIN duenos d ON d.id = p.dueno_id WHERE ${where} ORDER BY p.id DESC LIMIT :limit OFFSET :offset`,
      { replacements: reps, type: QueryTypes.SELECT }
    );
    return { data: rows, page, limit };
  }

  async findById(id: number): Promise<any> {
    const rows = await this.sequelize.query(
      `SELECT p.*, d.nombre as dueno_nombre, d.telefono as dueno_telefono, d.email as dueno_email FROM pacientes p LEFT JOIN duenos d ON d.id = p.dueno_id WHERE p.id = :id LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    return rows[0] || null;
  }

  async getHistorial(pacienteId: number): Promise<any[]> {
    return this.sequelize.query(
      `SELECT c.* FROM consultas c WHERE c.paciente_id = :pacienteId ORDER BY c.fecha_consulta DESC`,
      { replacements: { pacienteId }, type: QueryTypes.SELECT }
    );
  }

  async addVacuna(data: { paciente_id: number; vacuna_nombre: string; fecha_aplicacion: string; fecha_proxima?: string }): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO vacunas (paciente_id, vacuna_nombre, fecha_aplicacion, fecha_proxima, created_at) VALUES (:paciente_id, :vacuna_nombre, :fecha_aplicacion, :fecha_proxima, NOW())`,
      { replacements: data }
    );
    await invalidate(pacienteTags.byId(data.paciente_id), 'vacuna.add');
  }

  async internar(pacienteId: number, motivo: string): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO internaciones (paciente_id, motivo, fecha_ingreso, estado, created_at) VALUES (:pacienteId, :motivo, NOW(), 'internado', NOW())`,
      { replacements: { pacienteId, motivo } }
    );
    await invalidate(pacienteTags.byId(pacienteId), 'paciente.internar');
  }
}
