import {
    Controller,
    Post,
    Body,
    Get,
    Param,
    Delete,
    Patch,
    Req,
    UseGuards,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { TareasService } from './tareas.service';
import { CrearTareasDto } from './dto/crear-tareas.dto';
import { ActualizarTareasDto } from './dto/actualizar-tareas.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('tareas')
@UseGuards(JwtAuthGuard)
@Controller('tareas')
export class TareasController {
    private readonly logger = new Logger(TareasController.name);

    constructor(private readonly tareasService: TareasService) { }

    @Post()
    @ApiOperation({ summary: 'Crear una nueva tarea' })
    async crear(@Body() dto: CrearTareasDto, @Req() req: any) {
        try {
            const usuario = req.user?.usuario || 'sistema';
            this.logger.log(`Creando tarea por usuario: ${usuario}`);
            return await this.tareasService.crear(dto, usuario);
        } catch (error) {
            this.logger.error('Error al crear tarea', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las tareas' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todas las tareas...');
            return await this.tareasService.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener tareas', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener tarea por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo tarea ID: ${id}`);
            return await this.tareasService.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener tarea ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una tarea' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarTareasDto) {
        try {
            this.logger.log(`Actualizando tarea ID: ${id}`);
            return await this.tareasService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar tarea ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una tarea por ID' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando tarea ID: ${id}`);
            return await this.tareasService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar tarea ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
