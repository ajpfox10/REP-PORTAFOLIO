import {
    Controller,
    Post,
    Get,
    Patch,
    Delete,
    Param,
    Body,
    UseGuards,
    ParseIntPipe,
    Logger,
} from '@nestjs/common';
import { NomendadorService } from './nomendador.service';
import { CrearNomendadorDto } from './dto/crear-nomendador.dto';
import { ActualizarNomendadorDto } from './dto/actualizar-nomendador.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('nomendador')
@Controller('nomendador')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NomendadorController {
    private readonly logger = new Logger(NomendadorController.name);

    constructor(private readonly nomendadorService: NomendadorService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear nuevo nomendador' })
    async crear(@Body() dto: CrearNomendadorDto) {
        try {
            this.logger.log('Creando nomendador...');
            return await this.nomendadorService.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear nomendador', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Listar todos los nomendadores' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los nomendadores...');
            return await this.nomendadorService.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener nomendadores', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener nomendador por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo nomendador ID: ${id}`);
            return await this.nomendadorService.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener nomendador ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar nomendador' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarNomendadorDto) {
        try {
            this.logger.log(`Actualizando nomendador ID: ${id}`);
            return await this.nomendadorService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar nomendador ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar nomendador' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando nomendador ID: ${id}`);
            return await this.nomendadorService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar nomendador ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
