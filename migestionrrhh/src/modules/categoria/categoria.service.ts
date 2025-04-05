// Servicio para el módulo categoria
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Categoria } from './categoria.model';
import { CrearCategoriaDto } from './dto/categoria.dto';
import { ActualizarCategoriaDto } from './dto/actualizar-categoria.dto';

@Injectable()
export class CategoriaService {
    constructor(
        @InjectModel(Categoria)
        private readonly model: typeof Categoria,
    ) { }

    async crear(dto: CrearCategoriaDto): Promise<Categoria> {
        return this.model.create({
            ...dto,
            fechaDeAlta: dto.fechaDeAlta || new Date(),
        } as any);
    }

    async obtenerTodos(): Promise<Categoria[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Categoria> {
        const categoria = await this.model.findByPk(id);
        if (!categoria) throw new NotFoundException(`Categoría con ID ${id} no encontrada`);
        return categoria;
    }

    async actualizar(id: number, dto: ActualizarCategoriaDto): Promise<Categoria> {
        const categoria = await this.obtenerPorId(id);
        await categoria.update(dto);
        return categoria;
    }

    async eliminar(id: number): Promise<void> {
        const categoria = await this.obtenerPorId(id);
        await categoria.destroy();
    }
}
