import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Delete,
    Patch,
    UseGuards,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { SectorService } from './sector.service';
import { CrearSectorDto } from './dto/crear-sector.dto';
import { ActualizarSectorDto } from './dto/actualizar-sector.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('sector')
@UseGuards(JwtAuthGuard)
@Controller('sector')
export class SectorController {
    private readonly logger = new Logger(SectorController.name);

    constructor(private readonly sectorService: SectorService) { }

    @Post()
    @ApiOperation({ summary: 'Crear un sector' })
    async crear(@Body() dto: CrearSectorDto) {
        try {
            this.logger.log('Creando sector...');
            return await this.sectorService.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear sector', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los sectores' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los sectores...');
            return await this.sectorService.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener sectores', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener un sector por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo sector ID: ${id}`);
            return await this.sectorService.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener sector ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un sector' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarSectorDto) {
        try {
            this.logger.log(`Actualizando sector ID: ${id}`);
            return await this.sectorService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar sector ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar un sector' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando sector ID: ${id}`);
            return await this.sectorService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar sector ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
