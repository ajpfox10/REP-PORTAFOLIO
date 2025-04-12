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
    @ApiOperation({ summary: 'Crear un nuevo r�gimen horario' })
    async crear(@Body() dto: CrearRegimenhorariosDto) {
        try {
            this.logger.log('Creando r�gimen horario...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear r�gimen horario', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los reg�menes horarios' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los reg�menes horarios...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener reg�menes horarios', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener r�gimen horario por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo r�gimen horario ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener r�gimen horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar un r�gimen horario' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarRegimenhorariosDto) {
        try {
            this.logger.log(`Actualizando r�gimen horario ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar r�gimen horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un r�gimen horario' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando r�gimen horario ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar r�gimen horario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
