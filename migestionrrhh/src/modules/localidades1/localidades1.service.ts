import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Localidades1 } from './localidades1.model';
import { CrearLocalidades1Dto } from './dto/crear-localidades1.dto';

@Injectable()
export class Localidades1Service {
    constructor(
        @InjectModel(Localidades1)
        private readonly model: typeof Localidades1,
    ) { }

    async crear(data: CrearLocalidades1Dto): Promise<Localidades1> {
        return this.model.create({
            ...data,
            fechaDeAlta: new Date(),
        });
    }

    async obtenerPorId(id: number): Promise<Localidades1> {
        const entidad = await this.model.findByPk(id);
        if (!entidad) {
            throw new NotFoundException(`Localidad con ID ${id} no encontrada`);
        }
        return entidad;
    }

    async obtenerTodos(): Promise<Localidades1[]> {
        return this.model.findAll();
    }

    async eliminar(id: number): Promise<void> {
        const entidad = await this.model.findByPk(id);
        if (!entidad) {
            throw new NotFoundException(`Localidad con ID ${id} no encontrada`);
        }
        await entidad.destroy();
    }
}
