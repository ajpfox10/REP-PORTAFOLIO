import { Injectable, NotFoundException } from '@nestjs/common';

import { CrearResolucionDto } from './dto/crear-resolucion.dto';
import { ActualizarResolucionDto } from './dto/actualizar-resolucion.dto';
import { InjectModel } from '@nestjs/sequelize';
import { Resolucion } from './resoluciones.model'; // Asegurate de que el path sea correcto
@Injectable()
export class ResolucionesService {
  constructor(@InjectModel(Resolucion) private readonly resolucionModel: typeof Resolucion) {}

  async crear(dto: CrearResolucionDto) {
    return this.resolucionModel.create(dto as any);
  }
  async obtenerTodas(): Promise<Resolucion[]> {
        return this.resolucionModel.findAll();
  }

  async buscarPorId(id: number) {
    const resolucion = await this.resolucionModel.findByPk(id);
    if (!resolucion) throw new NotFoundException('Resolución no encontrada');
    return resolucion;
  }
    async actualizar(id: number, dto: ActualizarResolucionDto): Promise<Resolucion> {
        const resolucion = await this.resolucionModel.findByPk(id);
        if (!resolucion) {
            throw new Error(`Resolución con ID ${id} no encontrada`);
        }
        await resolucion.update(dto);
        return resolucion;
    }

    async eliminar(id: number): Promise<void> {
        const resolucion = await this.resolucionModel.findByPk(id);
        if (resolucion) {
            await resolucion.destroy();
        }
    }

}