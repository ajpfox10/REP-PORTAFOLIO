import {
    Controller,
    Post,
    Body,
    Get,
    Param,
    Patch,
    Delete,
    Logger,
    ParseIntPipe,
    UseGuards,
} from '@nestjs/common';
import { OrdenesdetrabajoService } from './ordenesdetrabajo.service';
import { CrearOrdenesdetrabajoDto } from './dto/crear-ordenesdetrabajo.dto';
import { ActualizarOrdenesdetrabajoDto } from './dto/actualizar-ordenesdetrabajo.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('ordenesdetrabajo')
@UseGuards(JwtAuthGuard)
@Controller('ordenesdetrabajo')
export class OrdenesdetrabajoController {
    private readonly logger = new Logger(OrdenesdetrabajoController.name);

    constructor(private readonly service: OrdenesdetrabajoService) { }

    @Post()
    @ApiOperation({ summary: 'Crear una orden de trabajo' })
    async crear(@Body() dto: CrearOrdenesdetrabajoDto) {
        try {
            this.logger.log('Creando orden de trabajo...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear orden de trabajo', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las órdenes de trabajo' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todas las órdenes de trabajo...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener órdenes de trabajo', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener una orden de trabajo por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo orden de trabajo ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener orden ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una orden de trabajo' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarOrdenesdetrabajoDto) {
        try {
            this.logger.log(`Actualizando orden ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar orden ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una orden de trabajo' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando orden ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar orden ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

