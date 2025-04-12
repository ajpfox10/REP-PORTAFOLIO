import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    ParseIntPipe,
    Patch,
    Delete,
    Logger,
} from '@nestjs/common';
import { Ocupacion1Service } from './ocupacion1.service';
import { CrearOcupacion1Dto } from './dto/crear-ocupacion1.dto';
import { ActualizarOcupacion1Dto } from './dto/actualizar-ocupacion1.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('ocupacion1')
@ApiBearerAuth()
@Controller('ocupacion1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class Ocupacion1Controller {
    private readonly logger = new Logger(Ocupacion1Controller.name);

    constructor(private readonly ocupacion1Service: Ocupacion1Service) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear una nueva ocupación' })
    async crear(@Body() dto: CrearOcupacion1Dto) {
        try {
            this.logger.log('Creando ocupación...');
            return await this.ocupacion1Service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear ocupación', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Listar todas las ocupaciones' })
    async obtenerTodos() {
        try {
            this.logger.log('Listando todas las ocupaciones...');
            return await this.ocupacion1Service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al listar ocupaciones', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener ocupación por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo ocupación ID: ${id}`);
            return await this.ocupacion1Service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener ocupación ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar ocupación' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarOcupacion1Dto) {
        try {
            this.logger.log(`Actualizando ocupación ID: ${id}`);
            return await this.ocupacion1Service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar ocupación ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar ocupación' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando ocupación ID: ${id}`);
            return await this.ocupacion1Service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar ocupación ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

