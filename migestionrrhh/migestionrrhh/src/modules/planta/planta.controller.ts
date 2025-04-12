import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Delete,
    Patch,
    Logger,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PlantaService } from './planta.service';
import { CrearPlantaDto } from './dto/crear-planta.dto';
import { ActualizarPlantaDto } from './dto/actualizar-planta.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('planta')
@UseGuards(JwtAuthGuard)
@Controller('planta')
export class PlantaController {
    private readonly logger = new Logger(PlantaController.name);

    constructor(private readonly service: PlantaService) { }

    @Post()
    @ApiOperation({ summary: 'Crear una nueva planta' })
    async crear(@Body() dto: CrearPlantaDto) {
        try {
            this.logger.log('Creando planta...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear planta', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las plantas' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todas las plantas...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener plantas', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener una planta por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo planta ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener planta ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una planta' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarPlantaDto) {
        try {
            this.logger.log(`Actualizando planta ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar planta ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una planta' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando planta ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar planta ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

