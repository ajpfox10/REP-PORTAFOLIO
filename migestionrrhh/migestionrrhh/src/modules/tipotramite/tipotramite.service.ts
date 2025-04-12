import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { TipoTramite } from './tipotramite.model';
import { CrearTipoTramiteDto } from './dto/crear-tipotramite.dto';
import { ActualizarTipoTramiteDto } from './dto/actualizar-tipotramite.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class TipotramiteService {
    private readonly logger = new Logger(TipotramiteService.name);

    constructor(
        @InjectModel(TipoTramite)
        private readonly tipoTramiteModel: typeof TipoTramite,
    ) {}

    async crear(data: CrearTipoTramiteDto): Promise<TipoTramite> {
        try {
            this.logger.log('Creando tipo de trámite...');
            return await this.tipoTramiteModel.create(data as TipoTramite);
        } catch (error) {
            this.logger.error('Error al crear tipo de trámite', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<TipoTramite[]> {
        try {
            this.logger.log('Obteniendo todos los tipos de trámite...');
            return await this.tipoTramiteModel.findAll();
        } catch (error) {
            this.logger.error('Error al obtener tipos de trámite', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<TipoTramite | null> {
        try {
            this.logger.log(`Buscando tipo de trámite ID: ${id}`);
            return await this.tipoTramiteModel.findByPk(id);
        } catch (error) {
            this.logger.error(`Error al obtener tipo de trámite ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando tipo de trámite ID: ${id}`);
            const tipo = await this.tipoTramiteModel.findByPk(id);
            if (!tipo) {
                this.logger.warn(`Tipo de trámite con ID ${id} no encontrado`);
                throw new NotFoundException(`Tipo de trámite con ID ${id} no encontrado`);
            }
            await tipo.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar tipo de trámite ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarTipoTramiteDto): Promise<TipoTramite> {
        try {
            this.logger.log(`Actualizando tipo de trámite ID: ${id}`);
            const tipo = await this.tipoTramiteModel.findByPk(id);
            if (!tipo) {
                this.logger.warn(`Tipo de trámite con ID ${id} no encontrado`);
                throw new NotFoundException(`Tipo de trámite con ID ${id} no encontrado`);
            }
            await tipo.update(dto);
            return tipo;
        } catch (error) {
            this.logger.error(`Error al actualizar tipo de trámite ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}


