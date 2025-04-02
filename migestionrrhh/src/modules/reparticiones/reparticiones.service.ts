import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Reparticiones } from './reparticiones.model';
import { CrearReparticionesDto } from './dto/crear-reparticiones.dto';

@Injectable()
export class ReparticionesService {
    constructor(
        @InjectModel(Reparticiones)
        private readonly model: typeof Reparticiones,
    ) { }

    async crear(data: CrearReparticionesDto): Promise<Reparticiones> {
        return this.model.create({
            ...(data as any),
            fechaDeAlta: new Date(),
        });
    }

    async obtenerTodos(): Promise<Reparticiones[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Reparticiones | null> {
        return this.model.findByPk(id);
    }
}