import {
    Controller,
    Post,
    Get,
    Param,
    Patch,
    Delete,
    Body,
    UseGuards,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { TipotramiteService } from './tipotramite.service';
import { CrearTipoTramiteDto } from './dto/crear-tipotramite.dto';
import { ActualizarTipoTramiteDto } from './dto/actualizar-tipotramite.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('tipotramite')
@UseGuards(JwtAuthGuard)
@Controller('tipotramite')
export class TipotramiteController {
    private readonly logger = new Logger(TipotramiteController.name);

    constructor(private readonly tipoTramiteService: TipotramiteService) {}

    @Post()
    @ApiOperation({ summary: 'Crear un nuevo tipo de trámite' })
    async crear(@Body() data: CrearTipoTramiteDto) {
        try {
            this.logger.log('Creando nuevo tipo de trámite...');
            return await this.tipoTramiteService.crear(data);
        } catch (error) {
            this.logger.error('Error al crear tipo de trámite', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los tipos de trámite' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los tipos de trámite...');
            return await this.tipoTramiteService.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener tipos de trámite', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener tipo de trámite por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo tipo de trámite ID: ${id}`);
            return await this.tipoTramiteService.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener tipo de trámite ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un tipo de trámite' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarTipoTramiteDto) {
        try {
            this.logger.log(`Actualizando tipo de trámite ID: ${id}`);
            return await this.tipoTramiteService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar tipo de trámite ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar un tipo de trámite por ID' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando tipo de trámite ID: ${id}`);
            return await this.tipoTramiteService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar tipo de trámite ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
