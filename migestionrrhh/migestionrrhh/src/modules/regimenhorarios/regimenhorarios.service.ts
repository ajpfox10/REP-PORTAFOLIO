import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Regimenhorarios } from './regimenhorarios.model';
import { CrearRegimenhorariosDto } from './dto/crear-regimenhorarios.dto';
import { ActualizarRegimenhorariosDto } from './dto/actualizar-regimenhorarios.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class RegimenhorariosService {
    private readonly logger = new Logger(RegimenhorariosService.name);

    constructor(
        @InjectModel(Regimenhorarios)
        private readonly model: typeof Regimenhorarios,
    ) { }

    async crear(data: CrearRegimenhorariosDto): Promise<Regimenhorarios> {
        try {
            this.logger.log('Creando nuevo r�gimen horario...');
            return await this.model.create({ ...(data as any), fechaDeAlta: new Date() });
        } catch (error) {
            this.logger.error('Error al crear r�gimen horario', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Regimenhorarios[]> {
        try {
            this.logger.log('Listando todos los reg�menes horarios...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al listar reg�menes horarios', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Regimenhorarios> {
        try {
            this.logger.log(`Buscando r�gimen horario ID: ${id}`);
            const item = await this.model.findByPk(id);
            if (!item) {
                this.logger.warn(`R�gimen horario ID ${id} no encontrado`);
                throw new NotFoundException(`R�gimen horario con ID ${id} no encontrado`);
            }
            return item;
        } catch (error) {
            this.logger.error(`Error al obtener r�gimen horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarRegimenhorariosDto): Promise<Regimenhorarios> {
        try {
            this.logger.log(`Actualizando r�gimen horario ID: ${id}`);
            const item = await this.obtenerPorId(id);
            return await item.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar r�gimen horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando r�gimen horario ID: ${id}`);
            const item = await this.obtenerPorId(id);
            await item.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar r�gimen horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
