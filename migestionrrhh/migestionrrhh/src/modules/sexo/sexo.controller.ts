import {
    Controller,
    Get,
    Param,
    Delete,
    Patch,
    Body,
    UseGuards,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SexoService } from './sexo.service';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ActualizarSexoDto } from './dto/actualizar-sexo.dto';
import * as Sentry from '@sentry/node';

@ApiTags('sexo')
@Controller('sexo')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SexoController {
    private readonly logger = new Logger(SexoController.name);

    constructor(private readonly sexoService: SexoService) { }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un sexo por ID' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarSexoDto) {
        try {
            this.logger.log(`Actualizando sexo ID: ${id}`);
            return await this.sexoService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar sexo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener todos los sexos' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los sexos...');
            return await this.sexoService.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener sexos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener un sexo por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo sexo ID: ${id}`);
            return await this.sexoService.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener sexo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un sexo por ID' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando sexo ID: ${id}`);
            return await this.sexoService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar sexo ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

