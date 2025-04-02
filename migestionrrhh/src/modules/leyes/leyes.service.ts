import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ley } from './leyes.model';
import { CrearLeyDto } from './dto/crear-ley.dto';
import { CreationOptional, CreationAttributes } from 'sequelize';

@Injectable()
export class LeyesService {
    constructor(
        @InjectModel(Ley)
        private readonly leyModel: typeof Ley,
    ) { }

    async crearLey(dto: CrearLeyDto): Promise<Ley> {
        const nuevaLey = await this.leyModel.create({
            fechaDeAlta: new Date(),
            Ley: dto.Ley,
            codigoleyes: dto.codigoleyes,
            leyactiva: dto.leyactiva,
            usuarioCarga: dto.usuarioCarga,
        } as CreationAttributes<Ley>);

        return nuevaLey;
    }

    async obtenerTodas(): Promise<Ley[]> {
        return this.leyModel.findAll();
    }

    async obtenerPorId(id: number): Promise<Ley> {
        const ley = await this.leyModel.findByPk(id);
        if (!ley) {
            throw new NotFoundException(`Ley con ID ${id} no encontrada`);
        }
        return ley;
    }

    async eliminar(id: number): Promise<void> {
        const resultado = await this.leyModel.destroy({ where: { id } });
        if (!resultado) {
            throw new NotFoundException(`Ley con ID ${id} no encontrada`);
        }
    }
}
