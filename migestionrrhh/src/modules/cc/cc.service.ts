// Servicio para el módulo 
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Cc } from './cc.model';
import { CrearCcDto } from './dto/cc.dto';
import { ActualizarCcDto } from './dto/actualizar-cc.dto';
import { CreationAttributes } from 'sequelize';

@Injectable()
export class CcService {
    constructor(
        @InjectModel(Cc)
        private readonly model: typeof Cc,
    ) { }

    async crear(data: CrearCcDto): Promise<Cc> {
        return this.model.create({
            ...data,
            fechaDeAlta: data.fechaDeAlta || new Date(),
        } as CreationAttributes<Cc>);
    }

    async obtenerTodos(): Promise<Cc[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Cc> {
        const item = await this.model.findByPk(id);
        if (!item) {
            throw new NotFoundException(`CC con ID ${id} no encontrado`);
        }
        return item;
    }

    async actualizar(id: number, dto: ActualizarCcDto): Promise<Cc> {
        const item = await this.obtenerPorId(id);
        await item.update(dto);
        return item;
    }

    async eliminar(id: number): Promise<void> {
        const item = await this.obtenerPorId(id);
        await item.destroy();
    }
}
