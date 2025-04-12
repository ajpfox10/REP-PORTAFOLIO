import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Delete,
    Patch,
    Logger,
    ParseIntPipe,
    UseGuards,
} from '@nestjs/common';
import { Localidades1Service } from './localidades1.service';
import { CrearLocalidades1Dto } from './dto/crear-localidades1.dto';
import { ActualizarLocalidades1Dto } from './dto/actualizar_localidades1.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('localidades1')
@UseGuards(JwtAuthGuard)
@Controller('localidades1')
export class Localidades1Controller {
    private readonly logger = new Logger(Localidades1Controller.name);

    constructor(private readonly service: Localidades1Service) { }

    @Post()
    @ApiOperation({ summary: 'Crear una nueva localidad' })
    async crear(@Body() dto: CrearLocalidades1Dto) {
        try {
            this.logger.log('Creando localidad...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear localidad', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las localidades' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todas las localidades...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener localidades', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener localidad por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo localidad ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener localidad ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar localidad' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarLocalidades1Dto) {
        try {
            this.logger.log(`Actualizando localidad ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar localidad ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar localidad' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando localidad ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar localidad ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
