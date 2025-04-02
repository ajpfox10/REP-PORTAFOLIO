import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Rangoshorarios } from './rangoshorarios.model';
import { CrearRangoshorariosDto } from './dto/crear-rangoshorarios.dto';

@Injectable()
export class RangoshorariosService {
    constructor(
        @InjectModel(Rangoshorarios)
        private readonly model: typeof Rangoshorarios,
    ) { }

    async crear(data: CrearRangoshorariosDto): Promise<Rangoshorarios> {
        return this.model.create({
            ...(data as any),
            fechaDeAlta: new Date(),
        });
    }

    async buscarPorId(id: number): Promise<Rangoshorarios> {
        const result = await this.model.findByPk(id);
        if (!result) {
            throw new NotFoundException('Rango horario no encontrado');
        }
        return result;
    }
}