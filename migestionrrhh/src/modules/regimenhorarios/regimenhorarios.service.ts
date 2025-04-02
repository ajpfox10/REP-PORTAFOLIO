import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Regimenhorarios } from './regimenhorarios.model';
import { CrearRegimenhorariosDto } from './dto/crear-regimenhorarios.dto';


@Injectable()
export class RegimenhorariosService {
    constructor(
        @InjectModel(Regimenhorarios)
        private readonly model: typeof Regimenhorarios,
    ) { }

    async crear(data: CrearRegimenhorariosDto): Promise<Regimenhorarios> {
        return this.model.create({
            ...data,
            fechaDeAlta: new Date(),
        } as any);
    }

    async obtenerPorId(id: number): Promise<Regimenhorarios | null> {
        return this.model.findByPk(id);
    }

    async obtenerTodos(): Promise<Regimenhorarios[]> {
        return this.model.findAll();
    }

    async eliminar(id: number): Promise<void> {
        const registro = await this.model.findByPk(id);
        if (registro) {
            await registro.destroy();
        }
    }
}
