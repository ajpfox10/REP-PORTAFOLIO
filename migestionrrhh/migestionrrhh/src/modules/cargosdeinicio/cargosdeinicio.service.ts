import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Cargosdeinicio } from './cargosdeinicio.model';
import { CrearCargosDeInicioDto } from './dto/cargosdeinicio.dto';
import { ActualizarCargosDeInicioDto } from './dto/actualizar-cargosdeinicio.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class CargosdeinicioService {
    private readonly logger = new Logger(CargosdeinicioService.name);

    constructor(
        @InjectModel(Cargosdeinicio)
        private readonly model: typeof Cargosdeinicio,
    ) { }

    async crear(dto: CrearCargosDeInicioDto): Promise<Cargosdeinicio> {
        try {
            this.logger.log('Creando nuevo cargo...');
            return await this.model.create({
                ...dto,
                fechaDeAlta: dto.fechaDeAlta || new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear cargo', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Cargosdeinicio[]> {
        try {
            this.logger.log('Obteniendo todos los cargos...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener todos los cargos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Cargosdeinicio> {
        try {
            this.logger.log(`Buscando cargo ID: ${id}`);
            const cargo = await this.model.findByPk(id);
            if (!cargo) {
                this.logger.warn(`Cargo ID: ${id} no encontrado`);
                throw new NotFoundException(`Cargo con ID ${id} no encontrado`);
            }
            return cargo;
        } catch (error) {
            this.logger.error(`Error al buscar cargo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarCargosDeInicioDto): Promise<Cargosdeinicio> {
        try {
            this.logger.log(`Actualizando cargo ID: ${id}`);
            const cargo = await this.obtenerPorId(id);
            return await cargo.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar cargo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando cargo ID: ${id}`);
            const cargo = await this.obtenerPorId(id);
            await cargo.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar cargo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
