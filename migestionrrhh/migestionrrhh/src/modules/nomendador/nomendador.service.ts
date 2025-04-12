import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Nomendador } from './nomendador.model';
import { CrearNomendadorDto } from './dto/crear-nomendador.dto';
import { ActualizarNomendadorDto } from './dto/actualizar-nomendador.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class NomendadorService {
    private readonly logger = new Logger(NomendadorService.name);

    constructor(
        @InjectModel(Nomendador)
        private readonly model: typeof Nomendador,
    ) { }

    async crear(dto: CrearNomendadorDto): Promise<Nomendador> {
        try {
            this.logger.log('Creando nomendador...');
            return await this.model.create({
                ...dto,
                fechaDeAlta: dto.fechaDeAlta ?? new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear nomendador', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Nomendador[]> {
        try {
            this.logger.log('Obteniendo todos los nomendadores...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener nomendadores', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Nomendador> {
        try {
            this.logger.log(`Buscando nomendador ID: ${id}`);
            const item = await this.model.findByPk(id);
            if (!item) {
                this.logger.warn(`Nomendador ID ${id} no encontrado`);
                throw new NotFoundException(`Nomendador con ID ${id} no encontrado`);
            }
            return item;
        } catch (error) {
            this.logger.error(`Error al buscar nomendador ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarNomendadorDto): Promise<Nomendador> {
        try {
            this.logger.log(`Actualizando nomendador ID: ${id}`);
            const item = await this.obtenerPorId(id);
            return await item.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar nomendador ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando nomendador ID: ${id}`);
            const item = await this.obtenerPorId(id);
            await item.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar nomendador ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

