import {
    Injectable,
    NotFoundException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Scaneardocumentacion } from './scaneardocumentacion.model';
import { CrearScaneardocumentacionDto } from './dto/crear-scaneardocumentacion.dto';
import { ActualizarScaneardocumentacionDto } from './dto/actualizar-scaneardocumentacion.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class ScaneardocumentacionService {
    private readonly logger = new Logger(ScaneardocumentacionService.name);

    constructor(
        @InjectModel(Scaneardocumentacion)
        private readonly model: typeof Scaneardocumentacion,
    ) { }

    async crear(data: CrearScaneardocumentacionDto): Promise<Scaneardocumentacion> {
        try {
            this.logger.log('Creando nuevo documento escaneado...');
            return await this.model.create({ ...(data as any), fechaDeAlta: new Date() });
        } catch (error) {
            this.logger.error('Error al crear documento escaneado', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Scaneardocumentacion> {
        try {
            this.logger.log(`Buscando documento ID: ${id}`);
            const doc = await this.model.findByPk(id);
            if (!doc) {
                this.logger.warn(`Documento con ID ${id} no encontrado`);
                throw new NotFoundException('Documento no encontrado');
            }
            return doc;
        } catch (error) {
            this.logger.error(`Error al buscar documento ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarScaneardocumentacionDto): Promise<Scaneardocumentacion> {
        try {
            this.logger.log(`Actualizando documento ID: ${id}`);
            const doc = await this.obtenerPorId(id);
            return await doc.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar documento ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando documento ID: ${id}`);
            const doc = await this.obtenerPorId(id);
            return await doc.destroy();

        } catch (error) {
            this.logger.error(`Error al eliminar documento ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
