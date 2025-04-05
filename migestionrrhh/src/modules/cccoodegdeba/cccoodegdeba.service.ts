// Servicio para el módulo cccoodegdeba
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CCCoodegdeba } from './cccoodegdeba.model';
import { CrearCccoodegdebaDto } from './dto/cccoodegdeba.dto';
import { ActualizarCccoodegdebaDto } from './dto/actualizar-cccoodegdeba.dto';

@Injectable()
export class CccoodegdebaService {
    constructor(
        @InjectModel(CCCoodegdeba)
        private readonly model: typeof CCCoodegdeba,
    ) { }

    async crear(dto: CrearCccoodegdebaDto): Promise<CCCoodegdeba> {
        return this.model.create({
            ...dto,
            fechaDeAlta: new Date(),
        } as any);
    }

    async obtenerTodos(): Promise<CCCoodegdeba[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<CCCoodegdeba> {
        const item = await this.model.findByPk(id);
        if (!item) {
            throw new NotFoundException(`Registro con ID ${id} no encontrado`);
        }
        return item;
    }

    async actualizar(id: number, dto: ActualizarCccoodegdebaDto): Promise<CCCoodegdeba> {
        const item = await this.obtenerPorId(id);
        await item.update(dto);
        return item;
    }

    async eliminar(id: number): Promise<void> {
        const item = await this.obtenerPorId(id);
        await item.destroy();
    }
}
