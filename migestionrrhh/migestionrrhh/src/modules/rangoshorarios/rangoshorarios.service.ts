import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Rangoshorarios } from './rangoshorarios.model';
import { CrearRangoshorariosDto } from './dto/crear-rangoshorarios.dto';
import { ActualizarRangoshorariosDto } from './dto/actualizar-rangoshorarios.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class RangoshorariosService {
    private readonly logger = new Logger(RangoshorariosService.name);

    constructor(
        @InjectModel(Rangoshorarios)
        private readonly model: typeof Rangoshorarios,
    ) { }

    async crear(dto: CrearRangoshorariosDto): Promise<Rangoshorarios> {
        try {
            this.logger.log('Creando nuevo rango horario...');
            return await this.model.create({
                ...dto,
                fechaDeAlta: dto.fechaDeAlta || new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear rango horario', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Rangoshorarios[]> {
        try {
            this.logger.log('Listando todos los rangos horarios...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener todos los rangos horarios', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Rangoshorarios> {
        try {
            this.logger.log(`Buscando rango horario ID: ${id}`);
            const item = await this.model.findByPk(id);
            if (!item) {
                this.logger.warn(`Rango horario ID ${id} no encontrado`);
                throw new NotFoundException(`Rango horario con ID ${id} no encontrado`);
            }
            return item;
        } catch (error) {
            this.logger.error(`Error al obtener rango horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarRangoshorariosDto): Promise<Rangoshorarios> {
        try {
            this.logger.log(`Actualizando rango horario ID: ${id}`);
            const item = await this.obtenerPorId(id);
            return await item.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar rango horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando rango horario ID: ${id}`);
            const item = await this.obtenerPorId(id);
            await item.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar rango horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
