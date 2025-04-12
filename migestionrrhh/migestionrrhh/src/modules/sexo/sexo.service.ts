import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sexo } from './sexo.model';
import { ActualizarSexoDto } from './dto/actualizar-sexo.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class SexoService {
    private readonly logger = new Logger(SexoService.name);

    constructor(
        @InjectModel(Sexo)
        private readonly model: typeof Sexo,
    ) { }

    async obtenerTodos(): Promise<Sexo[]> {
        try {
            this.logger.log('Listando todos los sexos...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener todos los sexos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Sexo> {
        try {
            this.logger.log(`Buscando sexo ID: ${id}`);
            const sexo = await this.model.findByPk(id);
            if (!sexo) {
                this.logger.warn(`Sexo con ID ${id} no encontrado`);
                throw new NotFoundException(`Sexo con ID ${id} no encontrado`);
            }
            return sexo;
        } catch (error) {
            this.logger.error(`Error al obtener sexo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarSexoDto): Promise<Sexo> {
        try {
            this.logger.log(`Actualizando sexo ID: ${id}`);
            const sexo = await this.obtenerPorId(id);
            await sexo.update(dto);
            return sexo;
        } catch (error) {
            this.logger.error(`Error al actualizar sexo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando sexo ID: ${id}`);
            const sexo = await this.obtenerPorId(id);
            await sexo.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar sexo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

