import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { TipoTramite } from './tipotramite.model';
import { CrearTipoTramiteDto } from './dto/crear-tipotramite.dto';
import { NotFoundException } from '@nestjs/common';
import { ActualizarTipoTramiteDto } from './dto/actualizar-tipotramite.dto';
@Injectable()
export class TipotramiteService {
    constructor(
        @InjectModel(TipoTramite)
        private readonly tipoTramiteModel: typeof TipoTramite,
    ) { }

    async crear(data: CrearTipoTramiteDto): Promise<TipoTramite> {
        return this.tipoTramiteModel.create(data as TipoTramite); // 👈 casteo explícito
    }

    async obtenerTodos(): Promise<TipoTramite[]> {
        return this.tipoTramiteModel.findAll();
    }

    async obtenerPorId(id: number): Promise<TipoTramite | null> {
        return this.tipoTramiteModel.findByPk(id);
    }
    async eliminar(id: number): Promise<void> {
        const tipo = await this.tipoTramiteModel.findByPk(id);
        if (!tipo) throw new NotFoundException(`Tipo de trámite con ID ${id} no encontrado`);
        await tipo.destroy();
    }

    async actualizar(id: number, dto: ActualizarTipoTramiteDto): Promise<TipoTramite> {
        const tipo = await this.tipoTramiteModel.findByPk(id);
        if (!tipo) throw new NotFoundException(`Tipo de trámite con ID ${id} no encontrado`);
        await tipo.update(dto);
        return tipo;
    }

}

