import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sexo } from './sexo.model';

@Injectable()
export class SexoService {
    constructor(
        @InjectModel(Sexo)
        private readonly sexoModel: typeof Sexo,
    ) { }

    async obtenerTodos(): Promise<Sexo[]> {
        return this.sexoModel.findAll();
    }

    async obtenerPorId(id: number): Promise<Sexo> {
        const sexo = await this.sexoModel.findByPk(id);
        if (!sexo) {
            throw new NotFoundException(`Sexo con ID ${id} no encontrado`);
        }
        return sexo;
    }

    async eliminar(id: number): Promise<void> {
        const eliminado = await this.sexoModel.destroy({ where: { id } });
        if (!eliminado) {
            throw new NotFoundException(`Sexo con ID ${id} no encontrado para eliminar`);
        }
    }
}

