import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ordenesdetrabajo } from './ordenesdetrabajo.model';
import { CrearOrdenesdetrabajoDto } from './dto/crear-ordenesdetrabajo.dto';
import { ActualizarOrdenesdetrabajoDto } from './dto/actualizar-ordenesdetrabajo.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class OrdenesdetrabajoService {
    private readonly logger = new Logger(OrdenesdetrabajoService.name);

    constructor(
        @InjectModel(Ordenesdetrabajo)
        private readonly model: typeof Ordenesdetrabajo,
    ) { }

    async crear(dto: CrearOrdenesdetrabajoDto): Promise<Ordenesdetrabajo> {
        try {
            this.logger.log('Creando orden de trabajo...');
            return await this.model.create({
                ...dto,
                fechaDeAlta: dto.fechaDeAlta || new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear orden de trabajo', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Ordenesdetrabajo[]> {
        try {
            this.logger.log('Listando todas las órdenes...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener órdenes de trabajo', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Ordenesdetrabajo> {
        try {
            this.logger.log(`Buscando orden ID: ${id}`);
            const orden = await this.model.findByPk(id);
            if (!orden) {
                this.logger.warn(`Orden ID ${id} no encontrada`);
                throw new NotFoundException(`Orden con ID ${id} no encontrada`);
            }
            return orden;
        } catch (error) {
            this.logger.error(`Error al buscar orden ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarOrdenesdetrabajoDto): Promise<Ordenesdetrabajo> {
        try {
            this.logger.log(`Actualizando orden ID: ${id}`);
            const orden = await this.obtenerPorId(id);
            return await orden.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar orden ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando orden ID: ${id}`);
            const orden = await this.obtenerPorId(id);
            await orden.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar orden ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
