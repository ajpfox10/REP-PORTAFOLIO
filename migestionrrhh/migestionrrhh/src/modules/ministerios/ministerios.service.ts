import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ministerios } from './ministerios.model';
import { CrearMinisteriosDto } from './dto/crear-ministerios.dto';
import { ActualizarMinisteriosDto } from './dto/actualizar-ministerios.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class MinisteriosService {
    private readonly logger = new Logger(MinisteriosService.name);

    constructor(
        @InjectModel(Ministerios)
        private readonly model: typeof Ministerios,
    ) { }

    async crear(dto: CrearMinisteriosDto): Promise<Ministerios> {
        try {
            this.logger.log('Creando ministerio...');
            return await this.model.create({
                ...dto,
                fechaDeAlta: dto.fechaDeAlta ?? new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear ministerio', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Ministerios[]> {
        try {
            this.logger.log('Listando todos los ministerios...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al listar ministerios', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Ministerios> {
        try {
            this.logger.log(`Buscando ministerio ID: ${id}`);
            const item = await this.model.findByPk(id);
            if (!item) {
                this.logger.warn(`Ministerio ID ${id} no encontrado`);
                throw new NotFoundException(`Ministerio con ID ${id} no encontrado`);
            }
            return item;
        } catch (error) {
            this.logger.error(`Error al buscar ministerio ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarMinisteriosDto): Promise<Ministerios> {
        try {
            this.logger.log(`Actualizando ministerio ID: ${id}`);
            const item = await this.obtenerPorId(id);
            return await item.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar ministerio ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando ministerio ID: ${id}`);
            const item = await this.obtenerPorId(id);
            await item.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar ministerio ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
