import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ordenesdetrabajo } from './ordenesdetrabajo.model';
import { CrearOrdenesdetrabajoDto } from './dto/crear-ordenesdetrabajo.dto';

@Injectable()
export class OrdenesdetrabajoService {
    constructor(
        @InjectModel(Ordenesdetrabajo)
        private readonly model: typeof Ordenesdetrabajo,
    ) { }

    async crear(data: CrearOrdenesdetrabajoDto): Promise<Ordenesdetrabajo> {
        return this.model.create({ ...data, fechaDeAlta: new Date() } as any);
    }

    async obtenerTodos(): Promise<Ordenesdetrabajo[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Ordenesdetrabajo> {
        const item = await this.model.findByPk(id);
        if (!item) throw new NotFoundException('No encontrado');
        return item;
    }

    async eliminar(id: number): Promise<void> {
        const item = await this.obtenerPorId(id);
        await item.destroy();
    }
}
