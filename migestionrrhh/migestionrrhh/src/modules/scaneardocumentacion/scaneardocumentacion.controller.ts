import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Delete,
    Patch,
    UseGuards,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { ScaneardocumentacionService } from './scaneardocumentacion.service';
import { CrearScaneardocumentacionDto } from './dto/crear-scaneardocumentacion.dto';
import { ActualizarScaneardocumentacionDto } from './dto/actualizar-scaneardocumentacion.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('scaneardocumentacion')
@ApiBearerAuth()
@Controller('scaneardocumentacion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScaneardocumentacionController {
    private readonly logger = new Logger(ScaneardocumentacionController.name);

    constructor(private readonly service: ScaneardocumentacionService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear documento escaneado' })
    async crear(@Body() dto: CrearScaneardocumentacionDto) {
        try {
            this.logger.log('Creando documento escaneado...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear documento', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener documento por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo documento ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener documento ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar documento escaneado' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarScaneardocumentacionDto) {
        try {
            this.logger.log(`Actualizando documento ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar documento ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar documento escaneado' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando documento ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar documento ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
