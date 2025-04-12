import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ocupacion1 } from './ocupacion1.model';
import { CrearOcupacion1Dto } from './dto/crear-ocupacion1.dto';
import { ActualizarOcupacion1Dto } from './dto/actualizar-ocupacion1.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class Ocupacion1Service {
    private readonly logger = new Logger(Ocupacion1Service.name);

    constructor(
        @InjectModel(Ocupacion1)
        private readonly ocupacion1Model: typeof Ocupacion1,
    ) { }

    async crear(dto: CrearOcupacion1Dto): Promise<Ocupacion1> {
        try {
            this.logger.log('Creando ocupación...');
            return await this.ocupacion1Model.create({
                ...dto,
                fechaDeAlta: new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear ocupación', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Ocupacion1[]> {
        try {
            this.logger.log('Obteniendo todas las ocupaciones...');
            return await this.ocupacion1Model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener ocupaciones', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Ocupacion1> {
        try {
            this.logger.log(`Buscando ocupación ID: ${id}`);
            const ocupacion = await this.ocupacion1Model.findByPk(id);
            if (!ocupacion) {
                this.logger.warn(`Ocupación ID ${id} no encontrada`);
                throw new NotFoundException(`Ocupación con ID ${id} no encontrada`);
            }
            return ocupacion;
        } catch (error) {
            this.logger.error(`Error al buscar ocupación ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarOcupacion1Dto): Promise<Ocupacion1> {
        try {
            this.logger.log(`Actualizando ocupación ID: ${id}`);
            const ocupacion = await this.obtenerPorId(id);
            return await ocupacion.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar ocupación ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando ocupación ID: ${id}`);
            const ocupacion = await this.obtenerPorId(id);
            await ocupacion.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar ocupación ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
