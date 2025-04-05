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
} from '@nestjs/common';
import { CedulaService } from './cedula.service';
import { CrearCedulaDto } from './dto/cedula.dto';
import { ActualizarCedulaDto } from './dto/actualizar-cedula.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('cedulas')
@Controller('cedulas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CedulaController {
    constructor(private readonly cedulaService: CedulaService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear una cédula' })
    crear(@Body() dto: CrearCedulaDto) {
        return this.cedulaService.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las cédulas' })
    obtenerTodos() {
        return this.cedulaService.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener una cédula por ID' })
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.cedulaService.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar una cédula por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarCedulaDto) {
        return this.cedulaService.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar una cédula por ID' })
    eliminar(@Param('id') id: number) {
        return this.cedulaService.eliminar(id);
    }
}
