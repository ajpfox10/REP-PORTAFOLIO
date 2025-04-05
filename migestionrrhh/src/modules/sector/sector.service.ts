import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sector } from './sector.model';
import { CrearSectorDto } from './dto/crear-sector.dto';
import { ActualizarSectorDto } from './dto/actualizar-sector.dto'; // asegurate de tenerlo importado

@Injectable()
export class SectorService {
    constructor(
        @InjectModel(Sector)
        private readonly model: typeof Sector,
    ) { }

    async crear(data: CrearSectorDto): Promise<Sector> {
        return this.model.create({ ...(data as any), fechaDeAlta: new Date() });
    }

    async obtenerPorId(id: number): Promise<Sector | null> {
        return this.model.findByPk(id);
    }

    async obtenerTodos(): Promise<Sector[]> {
        return this.model.findAll();
    }

    async eliminar(id: number): Promise<number> {
        return this.model.destroy({ where: { id } });
    }
    async actualizar(id: number, dto: ActualizarSectorDto): Promise<Sector> {
        const sector = await this.model.findByPk(id);
        if (!sector) {
            throw new Error(`Sector con ID ${id} no encontrado`);
        }
        await sector.update(dto);
        return sector;
    }
}
