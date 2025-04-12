import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Patch,
    Delete,
    Logger,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { CrearPedidosDto } from './dto/crear-pedidos.dto';
import { ActualizarPedidosDto } from './dto/actualizar-pedidos.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('pedidos')
@UseGuards(JwtAuthGuard)
@Controller('pedidos')
export class PedidosController {
    private readonly logger = new Logger(PedidosController.name);

    constructor(private readonly service: PedidosService) { }

    @Post()
    @ApiOperation({ summary: 'Crear un pedido' })
    async crear(@Body() dto: CrearPedidosDto) {
        try {
            this.logger.log('Creando pedido...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear pedido', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los pedidos' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los pedidos...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener pedidos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener un pedido por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo pedido ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener pedido ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un pedido' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarPedidosDto) {
        try {
            this.logger.log(`Actualizando pedido ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar pedido ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar un pedido' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando pedido ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar pedido ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
