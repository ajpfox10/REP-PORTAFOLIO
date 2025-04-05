import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Localidades1 } from './localidades1.model';
import { CrearLocalidades1Dto } from './dto/crear-localidades1.dto';
import { ActualizarLocalidades1Dto } from './dto/actualizar_localidades1.dto';

@Injectable()
export class Localidades1Service {
    constructor(
        @InjectModel(Localidades1)
        private readonly model: typeof Localidades1,
    ) { }

    async crear(dto: CrearLocalidades1Dto): Promise<Localidades1> {
        return this.model.create({
            ...(dto as any),
            fechaDeAlta: new Date(),
        });
    }

    async obtenerTodos(): Promise<Localidades1[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Localidades1> {
        const localidad = await this.model.findByPk(id);
        if (!localidad) {
            throw new NotFoundException(`Localidad con ID ${id} no encontrada`);
        }
        return localidad;
    }

    async actualizar(id: number, dto: ActualizarLocalidades1Dto): Promise<Localidades1> {
        const localidad = await this.obtenerPorId(id);
        await localidad.update(dto);
        return localidad;
    }

    async eliminar(id: number): Promise<void> {
        const localidad = await this.obtenerPorId(id);
        await localidad.destroy();
    }
}
