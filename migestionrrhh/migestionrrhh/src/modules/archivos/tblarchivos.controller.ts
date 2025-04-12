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
import { TblarchivosService } from './tblarchivos.service';
import { CrearArchivoDto } from './dto/crear-archivo.dto';
import { ActualizarArchivoDto } from './dto/actualizar-archivo.dto';
import { EliminarArchivosDto } from './dto/eliminar-archivos.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('tblarchivos')
@Controller('tblarchivos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TblarchivosController {
    private readonly logger = new Logger(TblarchivosController.name);

    constructor(private readonly service: TblarchivosService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear archivo' })
    async crear(@Body() dto: CrearArchivoDto) {
        try {
            this.logger.log('Creando archivo...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear archivo', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Listar todos los archivos' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los archivos');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener archivos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener archivo por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo archivo ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener archivo ID: ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar archivo por ID' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarArchivoDto) {
        try {
            this.logger.log(`Actualizando archivo ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar archivo ID: ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar archivo por ID' })
    async eliminar(@Param('id', ParseIntPipe) id: number, @Body() dto: EliminarArchivosDto) {
        try {
            this.logger.log(`Eliminando archivo ID: ${id}`);
            return await this.service.eliminar(id, dto);
        } catch (error) {
            this.logger.error(`Error al eliminar archivo ID: ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
