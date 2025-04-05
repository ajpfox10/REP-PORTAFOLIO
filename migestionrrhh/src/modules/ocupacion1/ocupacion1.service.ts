import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ocupacion1 } from './ocupacion1.model';
import { CrearOcupacion1Dto } from './dto/crear-ocupacion1.dto';
import { ActualizarOcupacion1Dto } from './dto/actualizar-ocupacion1.dto';

@Injectable()
export class Ocupacion1Service {
    constructor(
        @InjectModel(Ocupacion1)
        private readonly ocupacion1Model: typeof Ocupacion1,
    ) { }

    async crear(dto: CrearOcupacion1Dto): Promise<Ocupacion1> {
        return this.ocupacion1Model.create({
            ...dto,
            fechaDeAlta: new Date(),
        } as any);
    }

    async obtenerTodos(): Promise<Ocupacion1[]> {
        return this.ocupacion1Model.findAll();
    }

    async obtenerPorId(id: number): Promise<Ocupacion1> {
        const ocupacion = await this.ocupacion1Model.findByPk(id);
        if (!ocupacion) {
            throw new NotFoundException(`Ocupación con ID ${id} no encontrada`);
        }
        return ocupacion;
    }

    async actualizar(id: number, dto: ActualizarOcupacion1Dto): Promise<Ocupacion1> {
        const ocupacion = await this.obtenerPorId(id);
        await ocupacion.update(dto);
        return ocupacion;
    }

    async eliminar(id: number): Promise<void> {
        const ocupacion = await this.obtenerPorId(id);
        await ocupacion.destroy();
    }
}
