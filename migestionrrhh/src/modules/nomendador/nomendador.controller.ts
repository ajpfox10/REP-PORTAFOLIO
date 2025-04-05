import {
    Controller,
    Post,
    Get,
    Patch,
    Delete,
    Param,
    Body,
    UseGuards,
} from '@nestjs/common';
import { NomendadorService } from './nomendador.service';
import { CrearNomendadorDto } from './dto/crear-nomendador.dto';
import { ActualizarNomendadorDto } from './dto/actualizar-nomendador.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('nomendador')
@Controller('nomendador')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NomendadorController {
    constructor(private readonly nomendadorService: NomendadorService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear nuevo nomendador' })
    crear(@Body() dto: CrearNomendadorDto) {
        return this.nomendadorService.crear(dto);
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener todos los nomendadores' })
    obtenerTodos() {
        return this.nomendadorService.obtenerTodos();
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener nomendador por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.nomendadorService.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar nomendador por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarNomendadorDto) {
        return this.nomendadorService.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar nomendador por ID' })
    eliminar(@Param('id') id: number) {
        return this.nomendadorService.eliminar(id);
    }
}
