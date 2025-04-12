import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Patch,
    Delete,
    UseGuards,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { RegimenhorariosService } from './regimenhorarios.service';
import { CrearRegimenhorariosDto } from './dto/crear-regimenhorarios.dto';
import { ActualizarRegimenhorariosDto } from './dto/actualizar-regimenhorarios.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('regimenhorarios')
@Controller('regimenhorarios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RegimenhorariosController {
    private readonly logger = new Logger(RegimenhorariosController.name);

    constructor(private readonly service: RegimenhorariosService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo régimen horario' })
    async crear(@Body() dto: CrearRegimenhorariosDto) {
        try {
            this.logger.log('Creando régimen horario...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear régimen horario', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los regímenes horarios' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los regímenes horarios...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener regímenes horarios', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener régimen horario por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo régimen horario ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener régimen horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar un régimen horario' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarRegimenhorariosDto) {
        try {
            this.logger.log(`Actualizando régimen horario ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar régimen horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un régimen horario' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando régimen horario ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar régimen horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
