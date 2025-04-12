import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Delete,
    Patch,
    UseGuards,
    ParseIntPipe,
    Logger,
} from '@nestjs/common';
import { CedulaService } from './cedula.service';
import { CrearCedulaDto } from './dto/cedula.dto';
import { ActualizarCedulaDto } from './dto/actualizar-cedula.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('cedulas')
@Controller('cedulas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CedulaController {
    private readonly logger = new Logger(CedulaController.name);

    constructor(private readonly cedulaService: CedulaService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear una cédula' })
    async crear(@Body() dto: CrearCedulaDto) {
        try {
            this.logger.log('Creando cédula...');
            return await this.cedulaService.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear cédula', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las cédulas' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todas las cédulas...');
            return await this.cedulaService.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener todas las cédulas', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener cédula por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo cédula ID: ${id}`);
            return await this.cedulaService.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener cédula ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar cédula por ID' })
    async actualizar(@Param('id') id: number, @Body() dto: ActualizarCedulaDto) {
        try {
            this.logger.log(`Actualizando cédula ID: ${id}`);
            return await this.cedulaService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar cédula ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar cédula por ID' })
    async eliminar(@Param('id') id: number) {
        try {
            this.logger.log(`Eliminando cédula ID: ${id}`);
            return await this.cedulaService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar cédula ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

