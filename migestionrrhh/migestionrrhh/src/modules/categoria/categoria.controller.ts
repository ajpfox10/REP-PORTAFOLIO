// Controlador para el módulo categoria
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
import { CategoriaService } from './categoria.service';
import { CrearCategoriaDto } from './dto/categoria.dto';
import { ActualizarCategoriaDto } from './dto/actualizar-categoria.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('categorias')
@Controller('categorias')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriaController {
    private readonly logger = new Logger(CategoriaController.name);

    constructor(private readonly service: CategoriaService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear una categoría' })
    async crear(@Body() dto: CrearCategoriaDto) {
        try {
            this.logger.log('Creando categoría...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear categoría', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener todas las categorías' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todas las categorías');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener categorías', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener una categoría por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo categoría ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener categoría ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar una categoría' })
    async actualizar(@Param('id') id: number, @Body() dto: ActualizarCategoriaDto) {
        try {
            this.logger.log(`Actualizando categoría ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar categoría ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar una categoría' })
    async eliminar(@Param('id') id: number) {
        try {
            this.logger.log(`Eliminando categoría ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar categoría ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
