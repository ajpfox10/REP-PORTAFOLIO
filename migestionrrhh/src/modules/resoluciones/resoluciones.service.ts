import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Resolucion } from '../../database/models/resolucion.model';
import { CrearResolucionDto } from './dto/crear-resolucion.dto';

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
}