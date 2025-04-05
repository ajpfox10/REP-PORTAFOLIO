import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ministerios } from './ministerios.model';
import { CrearMinisteriosDto } from './dto/crear-ministerios.dto';
import { ActualizarMinisteriosDto } from './dto/actualizar-ministerios.dto';

@Injectable()
export class MinisteriosService {
    constructor(
        @InjectModel(Ministerios)
        private readonly model: typeof Ministerios,
    ) { }

    async crear(dto: CrearMinisteriosDto): Promise<Ministerios> {
        return this.model.create({
            ...dto,
            fechaDeAlta: dto.fechaDeAlta ?? new Date(),
        } as any);
    }

    async obtenerTodos(): Promise<Ministerios[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Ministerios> {
        const item = await this.model.findByPk(id);
        if (!item) {
            throw new NotFoundException(`Ministerio con ID ${id} no encontrado`);
        }
        return item;
    }

    async actualizar(id: number, dto: ActualizarMinisteriosDto): Promise<Ministerios> {
        const item = await this.obtenerPorId(id);
        await item.update(dto);
        return item;
    }

    async eliminar(id: number): Promise<void> {
        const item = await this.obtenerPorId(id);
        await item.destroy();
    }
}
