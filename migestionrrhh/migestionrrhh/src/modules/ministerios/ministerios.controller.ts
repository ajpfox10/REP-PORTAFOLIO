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
import { MinisteriosService } from './ministerios.service';
import { CrearMinisteriosDto } from './dto/crear-ministerios.dto';
import { ActualizarMinisteriosDto } from './dto/actualizar-ministerios.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('ministerios')
@Controller('ministerios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MinisteriosController {
    private readonly logger = new Logger(MinisteriosController.name);

    constructor(private readonly service: MinisteriosService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo ministerio' })
    async crear(@Body() dto: CrearMinisteriosDto) {
        try {
            this.logger.log('Creando ministerio...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear ministerio', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Listar todos los ministerios' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los ministerios...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al listar ministerios', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener ministerio por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo ministerio ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener ministerio ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar ministerio' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarMinisteriosDto) {
        try {
            this.logger.log(`Actualizando ministerio ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar ministerio ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar ministerio' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando ministerio ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar ministerio ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
