import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ley } from './leyes.model';
import { CrearLeyDto } from './dto/crear-ley.dto';
import { ActualizarLeyDto } from './dto/actualizar-ley.dto';

@Injectable()
export class LeyesService {
    constructor(
        @InjectModel(Ley)
        private readonly model: typeof Ley,
    ) { }

    async crear(dto: CrearLeyDto): Promise<Ley> {
        return this.model.create({ ...(dto as any), fechaDeAlta: new Date() });
    }

    async obtenerTodos(): Promise<Ley[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Ley> {
        const ley = await this.model.findByPk(id);
        if (!ley) {
            throw new NotFoundException(`Ley con ID ${id} no encontrada`);
        }
        return ley;
    }

    async actualizar(id: number, dto: ActualizarLeyDto): Promise<Ley> {
        const ley = await this.obtenerPorId(id);
        await ley.update(dto);
        return ley;
    }

    async eliminar(id: number): Promise<void> {
        const ley = await this.obtenerPorId(id);
        await ley.destroy();
    }
}
