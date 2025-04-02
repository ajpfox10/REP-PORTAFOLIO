import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Pedidos } from './pedidos.model';
import { CrearPedidosDto } from './dto/crear-pedidos.dto';

@Injectable()
export class PedidosService {
    constructor(
        @InjectModel(Pedidos)
        private readonly model: typeof Pedidos,
    ) { }

    async crear(data: CrearPedidosDto): Promise<Pedidos> {
        return this.model.create({
            ...(data as any),
            fechaDeAlta: new Date(),
        });
    }

    async obtenerTodos(): Promise<Pedidos[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Pedidos | null> {
        return this.model.findByPk(id);
    }

    async actualizar(id: number, data: Partial<CrearPedidosDto>): Promise<[number]> {
        return this.model.update(data, { where: { id } });
    }

    async eliminar(id: number): Promise<number> {
        return this.model.destroy({ where: { id } });
    }
}