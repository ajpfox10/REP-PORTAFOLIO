import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CCCoodegdeba } from './cccoodegdeba.model';
import { CrearCccoodegdebaDto } from './dto/cccoodegdeba.dto';
import { ActualizarCccoodegdebaDto } from './dto/actualizar-cccoodegdeba.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class CccoodegdebaService {
    private readonly logger = new Logger(CccoodegdebaService.name);

    constructor(
        @InjectModel(CCCoodegdeba)
        private readonly model: typeof CCCoodegdeba,
    ) { }

    async crear(dto: CrearCccoodegdebaDto): Promise<CCCoodegdeba> {
        try {
            this.logger.log('Creando nuevo registro...');
            return await this.model.create({
                ...dto,
                fechaDeAlta: new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<CCCoodegdeba[]> {
        try {
            this.logger.log('Obteniendo todos los registros...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener todos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<CCCoodegdeba> {
        try {
            this.logger.log(`Buscando ID: ${id}`);
            const item = await this.model.findByPk(id);
            if (!item) {
                this.logger.warn(`Registro con ID ${id} no encontrado`);
                throw new NotFoundException(`Registro con ID ${id} no encontrado`);
            }
            return item;
        } catch (error) {
            this.logger.error(`Error al buscar ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarCccoodegdebaDto): Promise<CCCoodegdeba> {
        try {
            this.logger.log(`Actualizando ID: ${id}`);
            const item = await this.obtenerPorId(id);
            return await item.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number) {
        const registro = await this.model.findByPk(id);
        if (!registro) {
            throw new NotFoundException(`Registro con ID ${id} no encontrado`);
        }
        return await registro.destroy(); // ✅ Devuelve el resultado (en este caso 1)
    }

}
