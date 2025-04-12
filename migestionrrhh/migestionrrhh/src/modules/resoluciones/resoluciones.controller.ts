import {
    Controller,
    Post,
    Get,
    Body,
    Patch,
    Delete,
    Param,
    UseGuards,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { ResolucionesService } from './resoluciones.service';
import { CrearResolucionDto } from './dto/resoluciones.dto';
import { ActualizarResolucionDto } from './dto/actualizar-resolucion.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('resoluciones')
@UseGuards(JwtAuthGuard)
@Controller('resoluciones')
export class ResolucionesController {
    private readonly logger = new Logger(ResolucionesController.name);

    constructor(private readonly resolucionesService: ResolucionesService) { }

    @Post()
    @ApiOperation({ summary: 'Crear nueva resoluci�n' })
    async crear(@Body() dto: CrearResolucionDto) {
        try {
            this.logger.log('Creando resoluci�n...');
            return await this.resolucionesService.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear resoluci�n', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las resoluciones' })
    async obtenerTodas() {
        try {
            this.logger.log('Obteniendo todas las resoluciones...');
            return await this.resolucionesService.obtenerTodas();
        } catch (error) {
            this.logger.error('Error al obtener resoluciones', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener resoluci�n por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo resoluci�n ID: ${id}`);
            return await this.resolucionesService.buscarPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener resoluci�n ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar resoluci�n' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarResolucionDto) {
        try {
            this.logger.log(`Actualizando resoluci�n ID: ${id}`);
            return await this.resolucionesService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar resoluci�n ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar resoluci�n' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando resoluci�n ID: ${id}`);
            return await this.resolucionesService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar resoluci�n ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
