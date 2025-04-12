import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Reparticiones } from './reparticiones.model';
import { CrearReparticionesDto } from './dto/crear-reparticiones.dto';
import { ActualizarReparticionesDto } from './dto/actualizar-reparticiones.dto';

@Injectable()
export class ReparticionesService {
    constructor(
        @InjectModel(Reparticiones)
        private readonly reparticionModel: typeof Reparticiones,
    ) { }

    async obtenerTodos(): Promise<Reparticiones[]> {
        return this.reparticionModel.findAll();
    }

    async obtenerPorId(id: number): Promise<Reparticiones> {
        const reparticion = await this.reparticionModel.findByPk(id);
        if (!reparticion) {
            throw new NotFoundException(`Repartición con ID ${id} no encontrada`);
        }
        return reparticion;
    }

    async crear(dto: CrearReparticionesDto): Promise<Reparticiones> {
        // Solución: Crear objeto con solo las propiedades necesarias
        const crearData = {
            codigo: dto.codigo,
            descripcion: dto.descripcion,
            abreviatura: dto.abreviatura,
            fechaDeAlta: dto.fechaDeAlta || new Date(),
            usuarioCarga: dto.usuarioCarga || 'system'
        };

        return this.reparticionModel.create(crearData as any); // Usamos 'as any' para evitar el error de tipo
    }

    async actualizar(id: number, dto: ActualizarReparticionesDto): Promise<Reparticiones> {
        const reparticion = await this.reparticionModel.findByPk(id);
        if (!reparticion) {
            throw new NotFoundException(`Repartición con ID ${id} no encontrada`);
        }

        // Solución: Filtrar solo las propiedades definidas en el DTO
        const updateData: Partial<Reparticiones> = {};
        if (dto.codigo !== undefined) updateData.codigo = dto.codigo;
        if (dto.descripcion !== undefined) updateData.descripcion = dto.descripcion;
        if (dto.abreviatura !== undefined) updateData.abreviatura = dto.abreviatura;
        if (dto.fechaDeAlta !== undefined) updateData.fechaDeAlta = dto.fechaDeAlta;
        if (dto.usuarioCarga !== undefined) updateData.usuarioCarga = dto.usuarioCarga;

        return reparticion.update(updateData);
    }

    async eliminar(id: number): Promise<boolean> {
        const reparticion = await this.reparticionModel.findByPk(id);
        if (!reparticion) {
            throw new NotFoundException(`Repartición con ID ${id} no encontrada`);
        }
        await reparticion.destroy();
        return true;
    }
}