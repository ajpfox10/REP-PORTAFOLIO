// Servicio para el módulo cargosdeinicio
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Cargosdeinicio } from './cargosdeinicio.model';
import { CrearCargosDeInicioDto } from './dto/cargosdeinicio.dto';
import { ActualizarCargosDeInicioDto } from './dto/actualizar-cargosdeinicio.dto';

@Injectable()
export class CargosdeinicioService {
    constructor(
        @InjectModel(Cargosdeinicio)
        private readonly model: typeof Cargosdeinicio,
    ) { }

    async crear(dto: CrearCargosDeInicioDto): Promise<Cargosdeinicio> {
        return this.model.create({
            ...dto,
            fechaDeAlta: dto.fechaDeAlta || new Date(),
        } as any);
    }

    async obtenerTodos(): Promise<Cargosdeinicio[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Cargosdeinicio> {
        const item = await this.model.findByPk(id);
        if (!item) {
            throw new NotFoundException(`Cargo de inicio con ID ${id} no encontrado`);
        }
        return item;
    }

    async actualizar(id: number, dto: ActualizarCargosDeInicioDto): Promise<Cargosdeinicio> {
        const item = await this.obtenerPorId(id);
        return item.update(dto);
    }

    async eliminar(id: number): Promise<void> {
        const item = await this.obtenerPorId(id);
        await item.destroy();
    }
}
