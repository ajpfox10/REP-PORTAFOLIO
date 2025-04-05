import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Nomendador } from './nomendador.model';
import { CrearNomendadorDto } from './dto/crear-nomendador.dto';
import { ActualizarNomendadorDto } from './dto/actualizar-nomendador.dto';

@Injectable()
export class NomendadorService {
    constructor(
        @InjectModel(Nomendador)
        private readonly model: typeof Nomendador,
    ) { }

    async crear(dto: CrearNomendadorDto): Promise<Nomendador> {
        return this.model.create({
            ...dto,
            fechaDeAlta: dto.fechaDeAlta ?? new Date(),
        } as any);
    }

    async obtenerTodos(): Promise<Nomendador[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Nomendador> {
        const item = await this.model.findByPk(id);
        if (!item) {
            throw new NotFoundException(`Nomendador con ID ${id} no encontrado`);
        }
        return item;
    }

    async actualizar(id: number, dto: ActualizarNomendadorDto): Promise<Nomendador> {
        const item = await this.obtenerPorId(id);
        await item.update(dto);
        return item;
    }

    async eliminar(id: number): Promise<void> {
        const item = await this.obtenerPorId(id);
        await item.destroy();
    }
}
