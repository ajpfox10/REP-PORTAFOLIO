// src/modules/rangoshorarios/rangoshorarios.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Rangoshorarios } from './rangoshorarios.model';
import { CrearRangoshorariosDto } from './dto/crear-rangoshorarios.dto';
import { ActualizarRangoshorariosDto } from './dto/actualizar-rangoshorarios.dto';

@Injectable()
export class RangoshorariosService {
    constructor(
        @InjectModel(Rangoshorarios)
        private readonly model: typeof Rangoshorarios,
    ) { }

    async crear(dto: CrearRangoshorariosDto): Promise<Rangoshorarios> {
        const { fechaDeAlta, nombre, usuarioCarga } = dto;

        return this.model.create({
            nombre,
            usuarioCarga,
            fechaDeAlta: fechaDeAlta || new Date(),
        } as any); // usamos `as any` para evitar el error de tipado de Sequelize
    }

    async obtenerTodos(): Promise<Rangoshorarios[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Rangoshorarios> {
        const result = await this.model.findByPk(id);
        if (!result) {
            throw new NotFoundException(`Rango horario con ID ${id} no encontrado`);
        }
        return result;
    }

    async actualizar(id: number, dto: ActualizarRangoshorariosDto): Promise<Rangoshorarios> {
        const rango = await this.obtenerPorId(id);
        await rango.update(dto);
        return rango;
    }

    async eliminar(id: number): Promise<void> {
        const rango = await this.obtenerPorId(id);
        await rango.destroy();
    }
}
