// Servicio para el módulo cedula
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Cedula } from './cedula.model';
import { CrearCedulaDto } from './dto/cedula.dto';
import { ActualizarCedulaDto } from './dto/actualizar-cedula.dto';

@Injectable()
export class CedulaService {
    constructor(
        @InjectModel(Cedula)
        private readonly cedulaModel: typeof Cedula,
    ) { }

    async crear(dto: CrearCedulaDto): Promise<Cedula> {
        const { numero, fechaEmision, titular, domicilio, usuarioCarga } = dto;
        return this.cedulaModel.create({
            numero,
            fechaEmision,
            usuarioCarga,
        });
    }

    async obtenerTodos(): Promise<Cedula[]> {
        return this.cedulaModel.findAll();
    }

    async obtenerPorId(id: number): Promise<Cedula> {
        const cedula = await this.cedulaModel.findByPk(id);
        if (!cedula) {
            throw new NotFoundException(`Cédula con ID ${id} no encontrada`);
        }
        return cedula;
    }

    async actualizar(id: number, dto: ActualizarCedulaDto): Promise<Cedula> {
        const cedula = await this.obtenerPorId(id);
        await cedula.update(dto);
        return cedula;
    }

    async eliminar(id: number): Promise<void> {
        const cedula = await this.obtenerPorId(id);
        await cedula.destroy();
    }
}
