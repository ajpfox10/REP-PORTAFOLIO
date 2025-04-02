import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ministerios } from './ministerios.model';
import { CrearMinisteriosDto } from './dto/crear-ministerios.dto';

@Injectable()
export class MinisteriosService {
    constructor(
        @InjectModel(Ministerios)
        private readonly model: typeof Ministerios,
    ) { }

    async crear(data: CrearMinisteriosDto): Promise<Ministerios> {
        return this.model.create({
            ...(data as any),
            fechaDeAlta: new Date(),
        });
    }

    async eliminar(id: number): Promise<void> {
        const ministerio = await this.model.findByPk(id);
        if (!ministerio) {
            throw new NotFoundException(`Ministerio con ID ${id} no encontrado`);
        }
        await ministerio.destroy();
    }
    async obtenerTodos(): Promise<Ministerios[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Ministerios> {
        const ministerio = await this.model.findByPk(id);
        if (!ministerio) {
            throw new NotFoundException(`Ministerio con ID ${id} no encontrado`);
        }
        return ministerio;
    }
}