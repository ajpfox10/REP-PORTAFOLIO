import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Planta } from './planta.model';
import { CrearPlantaDto } from './dto/crear-planta.dto';
import { ActualizarPlantaDto } from './dto/actualizar-planta.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class PlantaService {
    private readonly logger = new Logger(PlantaService.name);

    constructor(
        @InjectModel(Planta)
        private readonly model: typeof Planta,
    ) { }

    async crear(dto: CrearPlantaDto): Promise<Planta> {
        try {
            this.logger.log('Creando planta...');
            return await this.model.create({
                ...(dto as any),
                fechaDeAlta: new Date(),
            });
        } catch (error) {
            this.logger.error('Error al crear planta', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Planta[]> {
        try {
            this.logger.log('Obteniendo todas las plantas...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener plantas', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Planta> {
        try {
            this.logger.log(`Buscando planta ID: ${id}`);
            const item = await this.model.findByPk(id);
            if (!item) {
                this.logger.warn(`Planta ID ${id} no encontrada`);
                throw new NotFoundException(`Planta con ID ${id} no encontrada`);
            }
            return item;
        } catch (error) {
            this.logger.error(`Error al obtener planta ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarPlantaDto): Promise<Planta> {
        try {
            this.logger.log(`Actualizando planta ID: ${id}`);
            const item = await this.obtenerPorId(id);
            return await item.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar planta ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando planta ID: ${id}`);
            const item = await this.obtenerPorId(id);
            await item.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar planta ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
