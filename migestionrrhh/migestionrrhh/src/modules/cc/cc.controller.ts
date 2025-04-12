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
import { CcService } from './cc.service';
import { CrearCcDto } from './dto/cc.dto';
import { ActualizarCcDto } from './dto/actualizar-cc.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('cc')
@ApiBearerAuth()
@Controller('cc')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CcController {
    private readonly logger = new Logger(CcController.name);

    constructor(private readonly ccService: CcService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo CC (solo admin)' })
    async crear(@Body() dto: CrearCcDto) {
        try {
            this.logger.log('Creando nuevo CC');
            return await this.ccService.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear CC', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Listar todos los CC (solo admin)' })
    async obtenerTodos() {
        try {
            this.logger.log('Listando todos los CC');
            return await this.ccService.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al listar CC', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener CC por ID (solo admin)' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo CC ID ${id}`);
            return await this.ccService.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener CC ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar CC por ID (solo admin)' })
    async actualizar(@Param('id') id: number, @Body() dto: ActualizarCcDto) {
        try {
            this.logger.log(`Actualizando CC ID ${id}`);
            return await this.ccService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar CC ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar CC por ID (solo admin)' })
    async eliminar(@Param('id') id: number) {
        try {
            this.logger.log(`Eliminando CC ID ${id}`);
            return await this.ccService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar CC ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
