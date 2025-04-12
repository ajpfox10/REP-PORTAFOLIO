import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Tblarchivos } from './tblarchivos.model';
import { CrearArchivoDto } from './dto/crear-archivo.dto';
import { ActualizarArchivoDto } from './dto/actualizar-archivo.dto';
import { EliminarArchivosDto } from './dto/eliminar-archivos.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class TblarchivosService {
    private readonly logger = new Logger(TblarchivosService.name);

    constructor(
        @InjectModel(Tblarchivos)
        private readonly model: typeof Tblarchivos,
    ) { }

    async crear(dto: CrearArchivoDto): Promise<Tblarchivos> {
        try {
            this.logger.log('Creando nuevo archivo');
            return await this.model.create({ ...dto, fechaDeAlta: new Date() } as any);
        } catch (error) {
            this.logger.error('Error al crear archivo', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Tblarchivos[]> {
        try {
            this.logger.log('Buscando todos los archivos');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener archivos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Tblarchivos> {
        try {
            this.logger.log(`Buscando archivo ID: ${id}`);
            const archivo = await this.model.findByPk(id);
            if (!archivo) {
                this.logger.warn(`Archivo ID: ${id} no encontrado`);
                throw new NotFoundException(`Archivo con ID ${id} no encontrado`);
            }
            return archivo;
        } catch (error) {
            this.logger.error(`Error al obtener archivo ID: ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarArchivoDto): Promise<Tblarchivos> {
        try {
            this.logger.log(`Actualizando archivo ID: ${id}`);
            const archivo = await this.obtenerPorId(id);
            return await archivo.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar archivo ID: ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number, dto: EliminarArchivosDto): Promise<void> {
        try {
            this.logger.log(`Eliminando archivo ID: ${id}`);
            const archivo = await this.obtenerPorId(id);
            await archivo.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar archivo ID: ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
