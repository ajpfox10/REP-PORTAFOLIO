import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Pedidos } from './pedidos.model';
import { CrearPedidosDto } from './dto/crear-pedidos.dto';
import { ActualizarPedidosDto } from './dto/actualizar-pedidos.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class PedidosService {
    private readonly logger = new Logger(PedidosService.name);

    constructor(
        @InjectModel(Pedidos)
        private readonly model: typeof Pedidos,
    ) { }

    async crear(dto: CrearPedidosDto): Promise<Pedidos> {
        try {
            this.logger.log('Creando pedido...');
            return await this.model.create({
                ...dto,
                fechaDeAlta: dto.fechaDeAlta || new Date(),
            } as any);
        } catch (error) {
            this.logger.error('Error al crear pedido', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Pedidos[]> {
        try {
            this.logger.log('Listando todos los pedidos...');
            return await this.model.findAll();
        } catch (error) {
            this.logger.error('Error al listar pedidos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Pedidos> {
        try {
            this.logger.log(`Buscando pedido ID: ${id}`);
            const pedido = await this.model.findByPk(id);
            if (!pedido) {
                this.logger.warn(`Pedido ID ${id} no encontrado`);
                throw new NotFoundException(`Pedido con ID ${id} no encontrado`);
            }
            return pedido;
        } catch (error) {
            this.logger.error(`Error al obtener pedido ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarPedidosDto): Promise<Pedidos> {
        try {
            this.logger.log(`Actualizando pedido ID: ${id}`);
            const pedido = await this.obtenerPorId(id);
            return await pedido.update(dto);
        } catch (error) {
            this.logger.error(`Error al actualizar pedido ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando pedido ID: ${id}`);
            const pedido = await this.obtenerPorId(id);
            await pedido.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar pedido ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

