import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Tareasadquiridias } from './tareasadquiridias.model';
import { CrearTareasadquiridiasDto } from './dto/crear-tareasadquiridias.dto';
import { ActualizarTareasadquiridiasDto } from './dto/actualizar-tareasadquiridias.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class TareasadquiridiasService {
    private readonly logger = new Logger(TareasadquiridiasService.name);

    constructor(
        @InjectModel(Tareasadquiridias)
        private readonly tareasadquiridiasModel: typeof Tareasadquiridias,
    ) {}

    async crear(dataSanitizada: CrearTareasadquiridiasDto, usuario: string): Promise<Tareasadquiridias> {
        try {
            this.logger.log(`Creando tarea adquirida para usuario: ${usuario}`);
            return await this.tareasadquiridiasModel.create({
                ...(dataSanitizada as any),
                fechaDeAlta: new Date(),
                usuarioCarga: usuario,
            });
        } catch (error) {
            this.logger.error('Error al crear tarea adquirida', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Tareasadquiridias[]> {
        try {
            this.logger.log('Obteniendo todas las tareas adquiridas...');
            return await this.tareasadquiridiasModel.findAll();
        } catch (error) {
            this.logger.error('Error al obtener tareas adquiridas', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Tareasadquiridias> {
        try {
            this.logger.log(`Buscando tarea adquirida con ID: ${id}`);
            const tarea = await this.tareasadquiridiasModel.findByPk(id);
            if (!tarea) {
                this.logger.warn(`Tarea adquirida con ID ${id} no encontrada`);
                throw new NotFoundException(`Tarea adquirida con ID ${id} no encontrada`);
            }
            return tarea;
        } catch (error) {
            this.logger.error(`Error al obtener tarea adquirida ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando tarea adquirida ID: ${id}`);
            const tarea = await this.tareasadquiridiasModel.findByPk(id);
            if (tarea) {
                await tarea.destroy();
            }
        } catch (error) {
            this.logger.error(`Error al eliminar tarea adquirida ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarTareasadquiridiasDto): Promise<Tareasadquiridias> {
        try {
            this.logger.log(`Actualizando tarea adquirida ID: ${id}`);
            const tarea = await this.obtenerPorId(id);
            await tarea.update(dto);
            return tarea;
        } catch (error) {
            this.logger.error(`Error al actualizar tarea adquirida ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
