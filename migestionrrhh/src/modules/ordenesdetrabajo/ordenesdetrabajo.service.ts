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

    async crear(data: CrearOrdenesdetrabajoDto): Promise<Ordenesdetrabajo> {
        return this.model.create({
            ...data,
            fechaDeAlta: new Date(),
        });
    }

    async obtenerTodos(): Promise<Ordenesdetrabajo[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Ordenesdetrabajo> {
        const orden = await this.model.findByPk(id);
        if (!orden) {
            throw new NotFoundException(`Orden de trabajo con ID ${id} no encontrada`);
        }
        return orden;
    }

    async actualizar(
        id: number,
        data: ActualizarOrdenesdetrabajoDto,
    ): Promise<[number, Ordenesdetrabajo[]]> {
        return this.model.update(data, {
            where: { id },
            returning: true,
        });
    }

    async eliminar(id: number): Promise<number> {
        return this.model.destroy({
            where: { id },
        });
    }
}
