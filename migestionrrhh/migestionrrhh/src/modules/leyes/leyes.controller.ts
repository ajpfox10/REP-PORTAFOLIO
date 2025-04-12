import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Patch,
    Delete,
    UseGuards,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { LeyesService } from './leyes.service';
import { CrearLeyDto } from './dto/crear-ley.dto';
import { ActualizarLeyDto } from './dto/actualizar-ley.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('leyes')
@ApiBearerAuth()
@Controller('leyes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeyesController {
    private readonly logger = new Logger(LeyesController.name);

    constructor(private readonly service: LeyesService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear una nueva ley (solo admin)' })
    async crear(@Body() dto: CrearLeyDto) {
        try {
            this.logger.log('Creando ley...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear ley', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @Roles(Rol.ADMIN, Rol.USER)
    @ApiOperation({ summary: 'Obtener todas las leyes' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todas las leyes...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener leyes', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @Roles(Rol.ADMIN, Rol.USER)
    @ApiOperation({ summary: 'Obtener una ley por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo ley ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener ley ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar ley por ID' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarLeyDto) {
        try {
            this.logger.log(`Actualizando ley ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar ley ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar ley por ID' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando ley ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar ley ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

