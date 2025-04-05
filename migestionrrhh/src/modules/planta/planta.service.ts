import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Planta } from './planta.model';
import { CrearPlantaDto } from './dto/crear-planta.dto';
import { ActualizarPlantaDto } from './dto/actualizar-planta.dto';

@Injectable()
export class PlantaService {
    constructor(
        @InjectModel(Planta)
        private readonly model: typeof Planta,
    ) { }

    async crear(dto: CrearPlantaDto): Promise<Planta> {
        return this.model.create({
            ...(dto as any),
            fechaDeAlta: new Date(),
        });
    }

    async obtenerTodos(): Promise<Planta[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Planta> {
        const item = await this.model.findByPk(id);
        if (!item) throw new NotFoundException(`Planta con ID ${id} no encontrada`);
        return item;
    }

    async actualizar(id: number, dto: ActualizarPlantaDto): Promise<Planta> {
        const item = await this.obtenerPorId(id);
        await item.update(dto);
        return item;
    }

    async eliminar(id: number): Promise<void> {
        const item = await this.obtenerPorId(id);
        await item.destroy();
    }
}
