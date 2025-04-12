import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Cedula } from './cedula.model';
import { CrearCedulaDto } from './dto/cedula.dto';
import { ActualizarCedulaDto } from './dto/actualizar-cedula.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class CedulaService {
    private readonly logger = new Logger(CedulaService.name);

    constructor(
        @InjectModel(Cedula)
        private readonly cedulaModel: typeof Cedula,
    ) { }

    async crear(dto: CrearCedulaDto): Promise<Cedula> {
        try {
            this.logger.log('Creando nueva cédula...');
            return await this.cedulaModel.create(dto as any);
        } catch (error) {
            this.logger.error('Error al crear cédula', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Cedula[]> {
        try {
            this.logger.log('Listando todas las cédulas...');
            return await this.cedulaModel.findAll();
        } catch (error) {
            this.logger.error('Error al obtener todas las cédulas', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Cedula> {
        try {
            this.logger.log(`Buscando cédula ID: ${id}`);
            const cedula = await this.cedulaModel.findByPk(id);
            if (!cedula) {
                this.logger.warn(`Cédula ID ${id} no encontrada`);
                throw new NotFoundException(`Cédula con ID ${id} no encontrada`);
            }
            return cedula;
        } catch (error) {
            this.logger.error(`Error al buscar cédula ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarCedulaDto): Promise<Cedula> {
        try {
            this.logger.log(`Actualizando cédula ID: ${id}`);
            const cedula = await this.obtenerPorId(id);
            return await cedula.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar cédula ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando cédula ID: ${id}`);
            const cedula = await this.obtenerPorId(id);
            await cedula.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar cédula ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

