import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Delete,
    Patch,
    UseGuards,
} from '@nestjs/common';
import { ScaneardocumentacionService } from './scaneardocumentacion.service';
import { CrearScaneardocumentacionDto } from './dto/crear-scaneardocumentacion.dto';
import { ActualizarScaneardocumentacionDto } from './dto/actualizar-scaneardocumentacion.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('scaneardocumentacion')
@ApiBearerAuth()
@Controller('scaneardocumentacion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScaneardocumentacionController {
    constructor(private readonly service: ScaneardocumentacionService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear documento escaneado (solo admin)' })
    crear(@Body() dto: CrearScaneardocumentacionDto) {
        return this.service.crear(dto);
    }

    @Get()
    @Roles(Rol.ADMIN, Rol.USER)
    @ApiOperation({ summary: 'Listar todos los documentos escaneados' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @Roles(Rol.ADMIN, Rol.USER)
    @ApiOperation({ summary: 'Obtener un documento escaneado por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar documento escaneado por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarScaneardocumentacionDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar documento escaneado por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
