import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Certificados } from './certificados.model';
import { CrearCertificadosDto } from './dto/certificados.dto';
import { ActualizarCertificadoDto } from './dto/actualizar-certificado.dto';

@Injectable()
export class CertificadosService {
    constructor(
        @InjectModel(Certificados)
        private readonly model: typeof Certificados,
    ) { }

    async crear(dto: CrearCertificadosDto): Promise<Certificados> {
        return this.model.create({
            ...dto,
            fechaDeAlta: dto.fechaDeAlta ?? new Date(),
        } as any);
    }

    async obtenerTodos(): Promise<Certificados[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Certificados> {
        const cert = await this.model.findByPk(id);
        if (!cert) {
            throw new NotFoundException(`Certificado con ID ${id} no encontrado`);
        }
        return cert;
    }

    async actualizar(id: number, dto: ActualizarCertificadoDto): Promise<Certificados> {
        const cert = await this.obtenerPorId(id);
        await cert.update(dto);
        return cert;
    }

    async eliminar(id: number): Promise<void> {
        const cert = await this.obtenerPorId(id);
        await cert.destroy();
    }
}
