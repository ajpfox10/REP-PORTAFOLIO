// Controlador para el módulo cargosdeinicio
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
import { CargosdeinicioService } from './cargosdeinicio.service';
import { CrearCargosDeInicioDto } from './dto/cargosdeinicio.dto';
import { ActualizarCargosDeInicioDto } from './dto/actualizar-cargosdeinicio.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('cargosdeinicio')
@Controller('cargosdeinicio')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CargosdeinicioController {
    constructor(private readonly service: CargosdeinicioService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo cargo de inicio' })
    crear(@Body() dto: CrearCargosDeInicioDto) {
        return this.service.crear(dto);
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener todos los cargos de inicio' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener un cargo de inicio por ID' })
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar un cargo de inicio' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarCargosDeInicioDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un cargo de inicio' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
