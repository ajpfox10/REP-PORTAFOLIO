import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    UseGuards,
    Put,
    Delete,
    Logger,
    ParseIntPipe,
} from '@nestjs/common';
import { UsuarioService } from './usuario.service';
import { CreateUsuarioDto } from './dto/usuario.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import * as Sentry from '@sentry/node';

@ApiTags('usuarios')
@ApiBearerAuth()
@Controller('usuarios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsuarioController {
    private readonly logger = new Logger(UsuarioController.name);

    constructor(private readonly usuarioService: UsuarioService) {}

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo usuario (solo admin)' })
    async crear(@Body() createUsuarioDto: CreateUsuarioDto) {
        try {
            this.logger.log('Creando nuevo usuario');
            return await this.usuarioService.crearUsuario(createUsuarioDto);
        } catch (error) {
            this.logger.error('Error al crear usuario', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener todos los usuarios (solo admin)' })
    async findAll() {
        try {
            this.logger.log('Obteniendo todos los usuarios');
            return await this.usuarioService.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener usuarios', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener un usuario por ID' })
    async findOne(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo usuario ID: ${id}`);
            return await this.usuarioService.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener usuario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Put(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar un usuario por ID (solo admin)' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarUsuarioDto) {
        try {
            this.logger.log(`Actualizando usuario ID: ${id}`);
            return await this.usuarioService.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar usuario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un usuario por ID (solo admin)' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando usuario ID: ${id}`);
            return await this.usuarioService.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar usuario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
