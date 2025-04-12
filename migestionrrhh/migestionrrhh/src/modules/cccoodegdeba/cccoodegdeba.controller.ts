import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Patch,
    Delete,
    UseGuards,
    ParseIntPipe,
    Logger,
} from '@nestjs/common';
import { CccoodegdebaService } from './cccoodegdeba.service';
import { CrearCccoodegdebaDto } from './dto/cccoodegdeba.dto';
import { ActualizarCccoodegdebaDto } from './dto/actualizar-cccoodegdeba.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('cccoodegdeba')
@ApiBearerAuth()
@Controller('cccoodegdeba')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CccoodegdebaController {
    private readonly logger = new Logger(CccoodegdebaController.name);

    constructor(private readonly service: CccoodegdebaService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo registro de cccoodegdeba' })
    async crear(@Body() dto: CrearCccoodegdebaDto) {
        try {
            this.logger.log('Creando registro...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener todos los registros' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los registros');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener todos', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener un registro por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo registro ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar un registro por ID' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarCccoodegdebaDto) {
        try {
            this.logger.log(`Actualizando registro ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un registro por ID' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando registro ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
