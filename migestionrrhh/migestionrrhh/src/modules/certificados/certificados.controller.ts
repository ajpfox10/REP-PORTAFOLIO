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
import { CertificadosService } from './certificados.service';
import { CrearCertificadosDto } from './dto/certificados.dto';
import { ActualizarCertificadoDto } from './dto/actualizar-certificado.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';

@ApiTags('certificados')
@Controller('certificados')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CertificadosController {
    private readonly logger = new Logger(CertificadosController.name);

    constructor(private readonly service: CertificadosService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear certificado' })
    async crear(@Body() dto: CrearCertificadosDto) {
        try {
            this.logger.log('Creando certificado...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear certificado', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Listar todos los certificados' })
    async obtenerTodos() {
        try {
            this.logger.log('Listando certificados...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al listar certificados', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener certificado por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo certificado ID ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener certificado ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar certificado por ID' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarCertificadoDto) {
        try {
            this.logger.log(`Actualizando certificado ID ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar certificado ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar certificado por ID' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando certificado ID ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar certificado ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
