import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { TblArchivos } from './tblarchivos.model';
import { CreationAttributes } from 'sequelize';

@Injectable()
export class TblArchivosService {
    constructor(
        @InjectModel(TblArchivos)
        private readonly tblArchivosModel: typeof TblArchivos,
    ) { }

    async create(data: CreationAttributes<TblArchivos>): Promise<TblArchivos> {
        return this.tblArchivosModel.create(data);
    }

    async findAll(): Promise<TblArchivos[]> {
        return this.tblArchivosModel.findAll();
    }

    async findOne(id: number): Promise<TblArchivos> {
        const archivo = await this.tblArchivosModel.findByPk(id);
        if (!archivo) throw new Error(`Archivo con id ${id} no encontrado`);
        return archivo;
    }

    async update(id: number, data: Partial<TblArchivos>): Promise<void> {
        await this.tblArchivosModel.update(data, { where: { id } });
    }

    async delete(id: number): Promise<void> {
        await this.tblArchivosModel.destroy({ where: { id } });
    }
}
