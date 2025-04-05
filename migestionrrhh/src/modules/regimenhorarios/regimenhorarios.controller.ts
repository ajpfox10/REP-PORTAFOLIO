import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Patch,
    Delete,
    UseGuards,
} from '@nestjs/common';
import { RegimenhorariosService } from './regimenhorarios.service';
import { CrearRegimenhorariosDto } from './dto/crear-regimenhorarios.dto';
import { ActualizarRegimenhorariosDto } from './dto/actualizar-regimenhorarios.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('regimenhorarios')
@Controller('regimenhorarios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RegimenhorariosController {
    constructor(private readonly service: RegimenhorariosService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo r�gimen horario' })
    crear(@Body() dto: CrearRegimenhorariosDto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Listar todos los reg�menes horarios' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener r�gimen horario por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un r�gimen horario' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarRegimenhorariosDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar un r�gimen horario por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}