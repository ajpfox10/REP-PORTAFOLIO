import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Reparticiones } from './reparticiones.model';
import { CrearReparticionesDto } from './dto/crear-reparticiones.dto';
import { ActualizarReparticionesDto } from './dto/actualizar-reparticiones.dto';

@Injectable()
export class ReparticionesService {
    constructor(
        @InjectModel(Reparticiones)
        private readonly model: typeof Reparticiones,
    ) { }

    async crear(data: CrearReparticionesDto): Promise<Reparticiones> {
        return this.model.create({
            ...(data as any),
            fechaDeAlta: new Date(),
        });
    }

    async obtenerTodos(): Promise<Reparticiones[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Reparticiones | null> {
        return this.model.findByPk(id);
    }

    async actualizar(id: number, dto: ActualizarReparticionesDto): Promise<Reparticiones> {
        const reparticion = await this.model.findByPk(id);
        if (!reparticion) {
            throw new NotFoundException(`Repartición con ID ${id} no encontrada`);
        }
        await reparticion.update(dto);
        return reparticion;
    }

    async eliminar(id: number): Promise<void> {
        const reparticion = await this.model.findByPk(id);
        if (!reparticion) {
            throw new NotFoundException(`Repartición con ID ${id} no encontrada`);
        }
        await reparticion.destroy();
    }
}
