import {
    Injectable,
    NotFoundException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CrearResolucionDto } from './dto/crear-resolucion.dto';
import { ActualizarResolucionDto } from './dto/actualizar-resolucion.dto';
import { Resolucion } from './resoluciones.model';
import * as Sentry from '@sentry/node';

@Injectable()
export class ResolucionesService {
    private readonly logger = new Logger(ResolucionesService.name);

    constructor(
        @InjectModel(Resolucion)
        private readonly resolucionModel: typeof Resolucion,
    ) { }

    async crear(dto: CrearResolucionDto) {
        try {
            this.logger.log('Creando nueva resolución...');
            return await this.resolucionModel.create({
                ...dto,
                fechaDeAlta: new Date(),
            });
        } catch (error) {
            this.logger.error('Error al crear resolución', error);
            Sentry.captureException(error);
            throw error;
        }
    }


    async obtenerTodas(): Promise<Resolucion[]> {
        try {
            this.logger.log('Listando resoluciones...');
            return await this.resolucionModel.findAll();
        } catch (error) {
            this.logger.error('Error al obtener resoluciones', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async buscarPorId(id: number): Promise<Resolucion> {
        try {
            this.logger.log(`Buscando resolución ID: ${id}`);
            const resolucion = await this.resolucionModel.findByPk(id);
            if (!resolucion) {
                this.logger.warn(`Resolución ID ${id} no encontrada`);
                throw new NotFoundException('Resolución no encontrada');
            }
            return resolucion;
        } catch (error) {
            this.logger.error(`Error al buscar resolución ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarResolucionDto): Promise<Resolucion> {
        try {
            this.logger.log(`Actualizando resolución ID: ${id}`);
            const resolucion = await this.buscarPorId(id);
            return await resolucion.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar resolución ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando resolución ID: ${id}`);
            const resolucion = await this.buscarPorId(id);
            await resolucion.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar resolución ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
