import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Patch,
    Delete,
    UseGuards,
} from '@nestjs/common';
import { LeyesService } from './leyes.service';
import { CrearLeyDto } from './dto/crear-ley.dto';
import { ActualizarLeyDto } from './dto/actualizar-ley.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('leyes')
@ApiBearerAuth()
@Controller('leyes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeyesController {
    constructor(private readonly service: LeyesService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear una nueva ley (solo admin)' })
    crear(@Body() dto: CrearLeyDto) {
        return this.service.crear(dto);
    }

    @Get()
    @Roles(Rol.ADMIN, Rol.USER)
    @ApiOperation({ summary: 'Obtener todas las leyes' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @Roles(Rol.ADMIN, Rol.USER)
    @ApiOperation({ summary: 'Obtener una ley por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar una ley por ID (solo admin)' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarLeyDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar una ley por ID (solo admin)' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
