import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { TipoTramite } from './tipotramite.model';
import { CrearTipoTramiteDto } from './dto/crear-tipotramite.dto';

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

    async actualizar(id: number, data: CrearTipoTramiteDto): Promise<void> {
        await this.tipoTramiteModel.update(data, { where: { ID: id } });
    }

    async eliminar(id: number): Promise<void> {
        await this.tipoTramiteModel.destroy({ where: { ID: id } });
    }
}

