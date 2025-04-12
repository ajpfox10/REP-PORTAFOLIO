// Controlador para el módulo cargosdeinicio
import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Patch,
    Delete,
    UseGuards,
    ParseIntPipe,
    Logger,
} from '@nestjs/common';
import { CargosdeinicioService } from './cargosdeinicio.service';
import { CrearCargosDeInicioDto } from './dto/cargosdeinicio.dto';
import { ActualizarCargosDeInicioDto } from './dto/actualizar-cargosdeinicio.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('cargosdeinicio')
@Controller('cargosdeinicio')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CargosdeinicioController {
    private readonly logger = new Logger(CargosdeinicioController.name);

    constructor(private readonly service: CargosdeinicioService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo cargo de inicio' })
    async crear(@Body() dto: CrearCargosDeInicioDto) {
        try {
            this.logger.log('Creando cargo de inicio');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear cargo', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener todos los cargos de inicio' })
    async obtenerTodos() {
        try {
            this.logger.log('Listando todos los cargos de inicio');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener todos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener un cargo de inicio por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo cargo ID ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener cargo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar un cargo de inicio' })
    async actualizar(@Param('id') id: number, @Body() dto: ActualizarCargosDeInicioDto) {
        try {
            this.logger.log(`Actualizando cargo ID ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar cargo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un cargo de inicio' })
    async eliminar(@Param('id') id: number) {
        try {
            this.logger.log(`Eliminando cargo ID ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar cargo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
