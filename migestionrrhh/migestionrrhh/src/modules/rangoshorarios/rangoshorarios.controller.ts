import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Patch,
    Delete,
    UseGuards,
    ParseIntPipe,
    Logger,
} from '@nestjs/common';
import { RangoshorariosService } from './rangoshorarios.service';
import { CrearRangoshorariosDto } from './dto/crear-rangoshorarios.dto';
import { ActualizarRangoshorariosDto } from './dto/actualizar-rangoshorarios.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('rangoshorarios')
@UseGuards(JwtAuthGuard)
@Controller('rangoshorarios')
export class RangoshorariosController {
    private readonly logger = new Logger(RangoshorariosController.name);

    constructor(private readonly service: RangoshorariosService) { }

    @Post()
    @ApiOperation({ summary: 'Crear un nuevo rango horario' })
    async crear(@Body() dto: CrearRangoshorariosDto) {
        try {
            this.logger.log('Creando rango horario...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear rango horario', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los rangos horarios' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los rangos horarios...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener rangos horarios', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener un rango horario por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo rango horario ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener rango horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un rango horario' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarRangoshorariosDto) {
        try {
            this.logger.log(`Actualizando rango horario ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar rango horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar un rango horario' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando rango horario ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar rango horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
