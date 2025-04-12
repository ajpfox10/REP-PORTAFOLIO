import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Ordenesdetrabajo } from './ordenesdetrabajo.model';

@Injectable()
export class OrdenesdetrabajoService {
    constructor(
        @InjectModel(Ordenesdetrabajo)
        private readonly model: typeof Ordenesdetrabajo,
    ) { }

    async crear(data: Partial<Ordenesdetrabajo>): Promise<Ordenesdetrabajo> {
        return this.model.create({ ...data, fechaDeAlta: new Date() } as any);
    }

    async obtenerTodos(): Promise<Ordenesdetrabajo[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Ordenesdetrabajo | null> {
        return this.model.findByPk(id);
    }

    async eliminar(id: number): Promise<void> {
        const instancia = await this.model.findByPk(id);
        if (instancia) await instancia.destroy();
    }
}