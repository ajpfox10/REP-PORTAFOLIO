import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ley } from './leyes.model';
import { CrearLeyDto } from './dto/crear-ley.dto';
import { ActualizarLeyDto } from './dto/actualizar-ley.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class LeyesService {
    private readonly logger = new Logger(LeyesService.name);

    constructor(
        @InjectModel(Ley)
        private readonly model: typeof Ley,
    ) { }

    async crear(dto: CrearLeyDto): Promise<Ley> {
        try {
            this.logger.log('Creando ley...');
            return await this.model.create({ ...(dto as any), fechaDeAlta: new Date() });
        } catch (error) {
            this.logger.error('Error al crear ley', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Ley[]> {
        try {
            this.logger.log('Obteniendo todas las leyes...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener leyes', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Ley> {
        try {
            this.logger.log(`Buscando ley ID: ${id}`);
            const ley = await this.model.findByPk(id);
            if (!ley) {
                this.logger.warn(`Ley ID ${id} no encontrada`);
                throw new NotFoundException(`Ley con ID ${id} no encontrada`);
            }
            return ley;
        } catch (error) {
            this.logger.error(`Error al buscar ley ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarLeyDto): Promise<Ley> {
        try {
            this.logger.log(`Actualizando ley ID: ${id}`);
            const ley = await this.obtenerPorId(id);
            return await ley.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar ley ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando ley ID: ${id}`);
            const ley = await this.obtenerPorId(id);
            await ley.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar ley ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

