import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Cc } from './cc.model';
import { CrearCcDto } from './dto/cc.dto';
import { ActualizarCcDto } from './dto/actualizar-cc.dto';
import { CreationAttributes } from 'sequelize';
import * as Sentry from '@sentry/node';

@Injectable()
export class CcService {
    private readonly logger = new Logger(CcService.name);

    constructor(
        @InjectModel(Cc)
        private readonly model: typeof Cc,
    ) { }

    async crear(data: CrearCcDto): Promise<Cc> {
        try {
            this.logger.log('Creando nuevo CC...');
            return await this.model.create({
                ...data,
                fechaDeAlta: data.fechaDeAlta || new Date(),
            } as CreationAttributes<Cc>);
        } catch (error) {
            this.logger.error('Error al crear CC', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Cc[]> {
        try {
            this.logger.log('Obteniendo todos los CC...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener todos los CC', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Cc> {
        try {
            this.logger.log(`Buscando CC ID: ${id}`);
            const item = await this.model.findByPk(id);
            if (!item) {
                this.logger.warn(`CC ID ${id} no encontrado`);
                throw new NotFoundException(`CC con ID ${id} no encontrado`);
            }
            return item;
        } catch (error) {
            this.logger.error(`Error al buscar CC ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarCcDto): Promise<Cc> {
        try {
            this.logger.log(`Actualizando CC ID: ${id}`);
            const item = await this.obtenerPorId(id);
            return await item.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar CC ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando CC ID: ${id}`);
            const item = await this.obtenerPorId(id);
            await item.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar CC ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

