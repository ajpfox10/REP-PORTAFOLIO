import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Certificados } from './certificados.model';
import { CrearCertificadosDto } from './dto/certificados.dto';
import { ActualizarCertificadoDto } from './dto/actualizar-certificado.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class CertificadosService {
    private readonly logger = new Logger(CertificadosService.name);

    constructor(
        @InjectModel(Certificados)
        private readonly model: typeof Certificados,
    ) { }

    async crear(dto: CrearCertificadosDto): Promise<Certificados> {
        try {
            this.logger.log('Creando nuevo certificado...');
            return await this.model.create({
                ...dto,
                fechaDeAlta: dto.fechaDeAlta ?? new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear certificado', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Certificados[]> {
        try {
            this.logger.log('Obteniendo todos los certificados...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al obtener todos los certificados', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Certificados> {
        try {
            this.logger.log(`Buscando certificado ID: ${id}`);
            const cert = await this.model.findByPk(id);
            if (!cert) {
                this.logger.warn(`Certificado ID ${id} no encontrado`);
                throw new NotFoundException(`Certificado con ID ${id} no encontrado`);
            }
            return cert;
        } catch (error) {
            this.logger.error(`Error al buscar certificado ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarCertificadoDto): Promise<Certificados> {
        try {
            this.logger.log(`Actualizando certificado ID: ${id}`);
            const cert = await this.obtenerPorId(id);
            return await cert.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar certificado ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando certificado ID: ${id}`);
            const cert = await this.obtenerPorId(id);
            await cert.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar certificado ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
