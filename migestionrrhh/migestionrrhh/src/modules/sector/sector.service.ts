import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sector } from './sector.model';
import { CrearSectorDto } from './dto/crear-sector.dto';
import { ActualizarSectorDto } from './dto/actualizar-sector.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class SectorService {
    private readonly logger = new Logger(SectorService.name);

    constructor(
        @InjectModel(Sector)
        private readonly model: typeof Sector,
    ) { }

    async crear(data: CrearSectorDto): Promise<Sector> {
        try {
            this.logger.log('Creando nuevo sector...');
            return await this.model.create({ ...(data as any), fechaDeAlta: new Date() });
        } catch (error) {
            this.logger.error('Error al crear sector', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Sector> {
        try {
            this.logger.log(`Buscando sector ID: ${id}`);
            const sector = await this.model.findByPk(id);
            if (!sector) {
                this.logger.warn(`Sector con ID ${id} no encontrado`);
                throw new NotFoundException(`Sector con ID ${id} no encontrado`);
            }
            return sector;
        } catch (error) {
            this.logger.error(`Error al obtener sector ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Sector[]> {
        try {
            this.logger.log('Obteniendo todos los sectores...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener sectores', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<number> {
        try {
            this.logger.log(`Eliminando sector ID: ${id}`);
            const sector = await this.model.findByPk(id);
            if (!sector) {
                this.logger.warn(`Sector con ID ${id} no encontrado`);
                throw new NotFoundException(`Sector con ID ${id} no encontrado`);
            }
            return await this.model.destroy({ where: { id } });
        } catch (error) {
            this.logger.error(`Error al eliminar sector ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarSectorDto): Promise<Sector> {
        try {
            this.logger.log(`Actualizando sector ID: ${id}`);
            const sector = await this.model.findByPk(id);
            if (!sector) {
                this.logger.warn(`Sector con ID ${id} no encontrado para actualizar`);
                throw new NotFoundException(`Sector con ID ${id} no encontrado`);
            }
            await sector.update(dto);
            return sector;
        } catch (error) {
            this.logger.error(`Error al actualizar sector ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

