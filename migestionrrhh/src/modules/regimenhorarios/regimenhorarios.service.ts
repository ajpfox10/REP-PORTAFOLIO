import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Regimenhorarios } from './regimenhorarios.model';
import { CrearRegimenhorariosDto } from './dto/crear-regimenhorarios.dto';
import { ActualizarRegimenhorariosDto } from './dto/actualizar-regimenhorarios.dto';

@Injectable()
export class RegimenhorariosService {
    constructor(
        @InjectModel(Regimenhorarios)
        private readonly model: typeof Regimenhorarios,
    ) { }

    async crear(data: CrearRegimenhorariosDto): Promise<Regimenhorarios> {
        return this.model.create({ ...(data as any), fechaDeAlta: new Date() });
    }

    async obtenerTodos(): Promise<Regimenhorarios[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Regimenhorarios> {
        const item = await this.model.findByPk(id);
        if (!item) {
            throw new NotFoundException(`Régimen horario con ID ${id} no encontrado`);
        }
        return item;
    }

    async eliminar(id: number): Promise<void> {
        const item = await this.obtenerPorId(id);
        await item.destroy();
    }
    async actualizar(id: number, dto: ActualizarRegimenhorariosDto): Promise<Regimenhorarios> {
        const item = await this.obtenerPorId(id);
        await item.update(dto);
        return item;
    }
}
