import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sexo } from './sexo.model';
import { ActualizarSexoDto } from './dto/actualizar-sexo.dto';

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

    async actualizar(id: number, dto: ActualizarSexoDto): Promise<Sexo> {
        const sexo = await this.obtenerPorId(id);
        if (!sexo) {
            throw new NotFoundException(`Sexo con ID ${id} no encontrado`);
        }
        await sexo.update(dto);
        return sexo;
    }

    async eliminar(id: number): Promise<void> {
        const sexo = await this.obtenerPorId(id);
        if (!sexo) {
            throw new NotFoundException(`Sexo con ID ${id} no encontrado`);
        }
        await sexo.destroy();
    }
}

