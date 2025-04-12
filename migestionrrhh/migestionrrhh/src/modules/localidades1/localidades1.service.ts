import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Localidades1 } from './localidades1.model';
import { CrearLocalidades1Dto } from './dto/crear-localidades1.dto';
import { ActualizarLocalidades1Dto } from './dto/actualizar_localidades1.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class Localidades1Service {
    private readonly logger = new Logger(Localidades1Service.name);

    constructor(
        @InjectModel(Localidades1)
        private readonly model: typeof Localidades1,
    ) { }

    async crear(dto: CrearLocalidades1Dto): Promise<Localidades1> {
        try {
            this.logger.log('Creando localidad...');
            return await this.model.create({
                ...(dto as any),
                fechaDeAlta: new Date(),
            });
        } catch (error) {
            this.logger.error('Error al crear localidad', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Localidades1[]> {
        try {
            this.logger.log('Listando todas las localidades...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al listar localidades', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Localidades1> {
        try {
            this.logger.log(`Buscando localidad ID: ${id}`);
            const localidad = await this.model.findByPk(id);
            if (!localidad) {
                this.logger.warn(`Localidad ID ${id} no encontrada`);
                throw new NotFoundException(`Localidad con ID ${id} no encontrada`);
            }
            return localidad;
        } catch (error) {
            this.logger.error(`Error al obtener localidad ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarLocalidades1Dto): Promise<Localidades1> {
        try {
            this.logger.log(`Actualizando localidad ID: ${id}`);
            const localidad = await this.obtenerPorId(id);
            return await localidad.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar localidad ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando localidad ID: ${id}`);
            const localidad = await this.obtenerPorId(id);
            await localidad.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar localidad ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
