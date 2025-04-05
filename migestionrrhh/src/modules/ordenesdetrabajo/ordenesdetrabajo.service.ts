import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ordenesdetrabajo } from './ordenesdetrabajo.model';
import { CrearOrdenesdetrabajoDto } from './dto/crear-ordenesdetrabajo.dto';
import { ActualizarOrdenesdetrabajoDto } from './dto/actualizar-ordenesdetrabajo.dto';

@Injectable()
export class OrdenesdetrabajoService {
    constructor(
        @InjectModel(Ordenesdetrabajo)
        private readonly model: typeof Ordenesdetrabajo,
    ) { }

    async crear(dto: CrearOrdenesdetrabajoDto): Promise<Ordenesdetrabajo> {
        return this.model.create({ ...dto, fechaDeAlta: dto.fechaDeAlta || new Date() } as any);
    }

    async obtenerTodos(): Promise<Ordenesdetrabajo[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Ordenesdetrabajo> {
        const orden = await this.model.findByPk(id);
        if (!orden) throw new NotFoundException(`Orden con ID ${id} no encontrada`);
        return orden;
    }

    async actualizar(id: number, dto: ActualizarOrdenesdetrabajoDto): Promise<Ordenesdetrabajo> {
        const orden = await this.obtenerPorId(id);
        await orden.update(dto);
        return orden;
    }

    async eliminar(id: number): Promise<void> {
        const orden = await this.obtenerPorId(id);
        await orden.destroy();
    }
}
