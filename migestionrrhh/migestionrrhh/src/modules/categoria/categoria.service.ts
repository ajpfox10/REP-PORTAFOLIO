// Servicio para el módulo categoria
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Categoria } from './categoria.model';
import { CrearCategoriaDto } from './dto/categoria.dto';
import { ActualizarCategoriaDto } from './dto/actualizar-categoria.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class CategoriaService {
    private readonly logger = new Logger(CategoriaService.name);

    constructor(
        @InjectModel(Categoria)
        private readonly model: typeof Categoria,
    ) { }

    async crear(dto: CrearCategoriaDto): Promise<Categoria> {
        try {
            this.logger.log('Creando categoría...');
            return await this.model.create({
                ...dto,
                fechaDeAlta: dto.fechaDeAlta || new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear categoría', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Categoria[]> {
        try {
            this.logger.log('Obteniendo todas las categorías');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener categorías', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Categoria> {
        try {
            this.logger.log(`Buscando categoría ID: ${id}`);
            const categoria = await this.model.findByPk(id);
            if (!categoria) {
                this.logger.warn(`Categoría ID ${id} no encontrada`);
                throw new NotFoundException(`Categoría con ID ${id} no encontrada`);
            }
            return categoria;
        } catch (error) {
            this.logger.error(`Error al buscar categoría ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarCategoriaDto): Promise<Categoria> {
        try {
            this.logger.log(`Actualizando categoría ID: ${id}`);
            const categoria = await this.obtenerPorId(id);
            return await categoria.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar categoría ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando categoría ID: ${id}`);
            const categoria = await this.obtenerPorId(id);
            await categoria.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar categoría ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
