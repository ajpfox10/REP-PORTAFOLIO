import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Planta } from './planta.model';
import { CrearPlantaDto } from './dto/crear-planta.dto';

@Injectable()
export class PlantaService {
    constructor(
        @InjectModel(Planta)
        private readonly model: typeof Planta,
    ) { }

    async crear(data: CrearPlantaDto): Promise<Planta> {
        return this.model.create({
            ...data,
            fechaDeAlta: new Date(),
        } as Planta);
    }

    async obtenerTodos(): Promise<Planta[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Planta | null> {
        return this.model.findByPk(id);
    }

    async eliminar(id: number): Promise<void> {
        const planta = await this.model.findByPk(id);
        if (planta) {
            await planta.destroy();
        }
    }
}
