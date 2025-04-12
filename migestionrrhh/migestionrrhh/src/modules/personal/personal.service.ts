import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Personal } from './personal.model';
import { CreatePersonalDto } from './dto/personal.dto';
import { ActualizarPersonalDto } from './dto/actualizar-personal.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class PersonalService {
    private readonly logger = new Logger(PersonalService.name);

    constructor(
        @InjectModel(Personal)
        private readonly model: typeof Personal,
    ) { }

    async crear(dto: CreatePersonalDto): Promise<Personal> {
        try {
            this.logger.log('Creando nuevo personal...');
            return await this.model.create({
                ...(dto as any),
                fechaDeAlta: new Date(),
            });
        } catch (error) {
            this.logger.error('Error al crear personal', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Personal[]> {
        try {
            this.logger.log('Listando todo el personal...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al listar personal', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Personal> {
        try {
            this.logger.log(`Buscando personal ID: ${id}`);
            const persona = await this.model.findByPk(id);
            if (!persona) {
                this.logger.warn(`Personal ID ${id} no encontrado`);
                throw new NotFoundException(`Personal con ID ${id} no encontrado`);
            }
            return persona;
        } catch (error) {
            this.logger.error(`Error al obtener personal ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarPersonalDto): Promise<Personal> {
        try {
            this.logger.log(`Actualizando personal ID: ${id}`);
            const persona = await this.obtenerPorId(id);
            return await persona.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar personal ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando personal ID: ${id}`);
            const persona = await this.obtenerPorId(id);
            await persona.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar personal ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
