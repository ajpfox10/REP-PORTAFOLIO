import {
    Controller,
    Post,
    Body,
    Get,
    Param,
    Patch,
    Req,
    Delete,
    UseGuards,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { TareasadquiridiasService } from './tareasadquiridias.service';
import { CrearTareasadquiridiasDto } from './dto/crear-tareasadquiridias.dto';
import { ActualizarTareasadquiridiasDto } from './dto/actualizar-tareasadquiridias.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('tareasadquiridas')
@UseGuards(JwtAuthGuard)
@Controller('tareasadquiridias')
export class TareasadquiridiasController {
    private readonly logger = new Logger(TareasadquiridiasController.name);

    constructor(private readonly tareasadquiridiasService: TareasadquiridiasService) { }

    @Post()
    @ApiOperation({ summary: 'Crear una tarea adquirida' })
    async crear(@Body() dto: CrearTareasadquiridiasDto, @Req() req: any) {
        try {
            const usuario = req.user?.usuario || 'sistema';
            this.logger.log(`Creando tarea adquirida por: ${usuario}`);
            return await this.tareasadquiridiasService.crear(dto, usuario);
        } catch (error) {
            this.logger.error('Error al crear tarea adquirida', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las tareas adquiridas' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todas las tareas adquiridas...');
            return await this.tareasadquiridiasService.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener tareas adquiridas', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener una tarea adquirida por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo tarea adquirida ID: ${id}`);
            return await this.tareasadquiridiasService.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener tarea adquirida ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una tarea adquirida' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarTareasadquiridiasDto) {
        try {
            this.logger.log(`Actualizando tarea adquirida ID: ${id}`);
            return await this.tareasadquiridiasService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar tarea adquirida ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una tarea adquirida por ID' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando tarea adquirida ID: ${id}`);
            return await this.tareasadquiridiasService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar tarea adquirida ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
