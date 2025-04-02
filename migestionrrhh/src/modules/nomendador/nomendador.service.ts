import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Nomendador } from './nomendador.model';
import { CrearNomendadorDto } from './dto/crear-nomendador.dto';

@Injectable()
export class NomendadorService {
    constructor(
        @InjectModel(Nomendador)
        private readonly model: typeof Nomendador,
    ) { }

    async crear(data: CrearNomendadorDto): Promise<Nomendador> {
        return this.model.create({ ...(data as any), fechaDeAlta: new Date() });
    }

    async obtenerTodos(): Promise<Nomendador[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Nomendador | null> {
        return this.model.findByPk(id);
    }

    async actualizar(id: number, data: Partial<CrearNomendadorDto>): Promise<Nomendador | null> {
        const instancia = await this.model.findByPk(id);
        if (!instancia) {
            return null;
        }
        await instancia.update(data);
        return instancia;
    }

    async eliminar(id: number): Promise<boolean> {
        const eliminado = await this.model.destroy({ where: { id } });
        return eliminado > 0;
    }
}
