import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Pedidos } from './pedidos.model';
import { CrearPedidosDto } from './dto/crear-pedidos.dto';
import { ActualizarPedidosDto } from './dto/actualizar-pedidos.dto';

@Injectable()
export class PedidosService {
    constructor(
        @InjectModel(Pedidos)
        private readonly model: typeof Pedidos,
    ) { }

    async crear(dto: CrearPedidosDto): Promise<Pedidos> {
        return this.model.create({
            ...dto,
            fechaDeAlta: dto.fechaDeAlta || new Date(),
        } as any); // cast para evitar errores Sequelize
    }

    async obtenerTodos(): Promise<Pedidos[]> {
        return this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Pedidos> {
        const pedido = await this.model.findByPk(id);
        if (!pedido) throw new NotFoundException(`Pedido con ID ${id} no encontrado`);
        return pedido;
    }

    async actualizar(id: number, dto: ActualizarPedidosDto): Promise<Pedidos> {
        const pedido = await this.obtenerPorId(id);
        await pedido.update(dto);
        return pedido;
    }

    async eliminar(id: number): Promise<void> {
        const pedido = await this.obtenerPorId(id);
        await pedido.destroy();
    }
}
