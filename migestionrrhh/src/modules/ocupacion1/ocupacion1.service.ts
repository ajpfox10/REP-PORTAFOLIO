import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ocupacion1 } from './ocupacion1.model';
import { CrearOcupacion1Dto } from './dto/crear-ocupacion1.dto';

@Injectable()
export class Ocupacion1Service {
    constructor(
        @InjectModel(Ocupacion1)
        private readonly ocupacion1Model: typeof Ocupacion1,
    ) { }

    async crear(dto: CrearOcupacion1Dto): Promise<Ocupacion1> {
        return this.ocupacion1Model.create({
            ...(dto as any),
            fechaDeAlta: new Date(),
        });
    }

    async buscarTodos(): Promise<Ocupacion1[]> {
        return this.ocupacion1Model.findAll();
    }

    async buscarPorId(id: number): Promise<Ocupacion1 | null> {
        return this.ocupacion1Model.findByPk(id);
    }

    async actualizar(id: number, dto: Partial<CrearOcupacion1Dto>): Promise<[number, Ocupacion1[]]> {
        return this.ocupacion1Model.update(dto, {
            where: { id },
            returning: true,
        });
    }

    async eliminar(id: number): Promise<number> {
        return this.ocupacion1Model.destroy({ where: { id } });
    }
    async obtenerTodos(): Promise<Ocupacion1[]> {
        return this.ocupacion1Model.findAll();
    }

    async obtenerPorId(id: number): Promise<Ocupacion1 | null> {
        return this.ocupacion1Model.findByPk(id);
    }
}