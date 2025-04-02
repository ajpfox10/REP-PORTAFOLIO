import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UsuarioService } from './usuario.service';
import { CreateUsuarioDto } from './dto/usuario.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('usuarios')
@ApiBearerAuth()
@Controller('usuarios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsuarioController {
    constructor(private readonly usuarioService: UsuarioService) { }

    @Post()
    @Roles('admin')
    @ApiOperation({ summary: 'Crear un nuevo usuario (solo admin)' })
    crear(@Body() createUsuarioDto: CreateUsuarioDto) {
        return this.usuarioService.crearUsuario(createUsuarioDto);
    }

    @Get()
    @Roles('admin')
    @ApiOperation({ summary: 'Obtener todos los usuarios (solo admin)' })
    findAll() {
        return this.usuarioService.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener un usuario por ID' })
    findOne(@Param('id') id: string) {
        return this.usuarioService.obtenerPorId(+id);
    }
}
