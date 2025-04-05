import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Patch,
    Delete,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { MinisteriosService } from './ministerios.service';
import { CrearMinisteriosDto } from './dto/crear-ministerios.dto';
import { ActualizarMinisteriosDto } from './dto/actualizar-ministerios.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('ministerios')
@Controller('ministerios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MinisteriosController {
    constructor(private readonly service: MinisteriosService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo ministerio' })
    crear(@Body() dto: CrearMinisteriosDto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los ministerios' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener un ministerio por ID' })
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar un ministerio por ID' })
    actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarMinisteriosDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un ministerio por ID' })
    eliminar(@Param('id', ParseIntPipe) id: number) {
        return this.service.eliminar(id);
    }
}
