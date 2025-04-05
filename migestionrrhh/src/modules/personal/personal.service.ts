import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Personal } from './personal.model';
import { CreatePersonalDto } from './dto/personal.dto';
import { ActualizarPersonalDto } from './dto/actualizar-personal.dto';

@Injectable()
export class PersonalService {
    constructor(
        @InjectModel(Personal)
        private readonly model: typeof Personal,
    ) { }

    async crear(dto: CreatePersonalDto): Promise<Personal> {
        return this.model.create({
            ...(dto as any),
            fechaDeAlta: new Date(),
        });
    }

    async obtenerTodos(): Promise<Personal[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Personal> {
        const persona = await this.model.findByPk(id);
        if (!persona) {
            throw new NotFoundException(`Personal con ID ${id} no encontrado`);
        }
        return persona;
    }

    async actualizar(id: number, dto: ActualizarPersonalDto): Promise<Personal> {
        const persona = await this.obtenerPorId(id);
        await persona.update(dto);
        return persona;
    }

    async eliminar(id: number): Promise<void> {
        const persona = await this.obtenerPorId(id);
        await persona.destroy();
    }
}
