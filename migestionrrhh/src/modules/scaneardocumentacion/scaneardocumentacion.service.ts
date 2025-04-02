import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Scaneardocumentacion } from './scaneardocumentacion.model';
import { CrearScaneardocumentacionDto } from './dto/crear-scaneardocumentacion.dto';

@Injectable()
export class ScaneardocumentacionService {
    constructor(
        @InjectModel(Scaneardocumentacion)
        private readonly model: typeof Scaneardocumentacion,
    ) { }

    async crear(data: CrearScaneardocumentacionDto): Promise<Scaneardocumentacion> {
        return this.model.create({
            ...(data as any),
            fechaDeAlta: new Date(),
        });
    }

    async obtenerPorId(id: number): Promise<Scaneardocumentacion> {
        const result = await this.model.findByPk(id);
        if (!result) {
            throw new NotFoundException('Documento no encontrado');
        }
        return result;
    }

    async obtenerTodos(): Promise<Scaneardocumentacion[]> {
        return this.model.findAll();
    }

    async eliminar(id: number): Promise<void> {
        const result = await this.model.findByPk(id);
        if (!result) {
            throw new NotFoundException('Documento no encontrado');
        }
        await result.destroy();
    }
}