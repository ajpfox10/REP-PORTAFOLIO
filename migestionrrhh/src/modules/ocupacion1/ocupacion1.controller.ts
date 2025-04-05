import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    ParseIntPipe,
    Patch,
    Delete,
} from '@nestjs/common';
import { Ocupacion1Service } from './ocupacion1.service';
import { CrearOcupacion1Dto } from './dto/crear-ocupacion1.dto';
import { ActualizarOcupacion1Dto } from './dto/actualizar-ocupacion1.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('ocupacion1')
@ApiBearerAuth()
@Controller('ocupacion1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class Ocupacion1Controller {
    constructor(private readonly ocupacion1Service: Ocupacion1Service) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear una nueva ocupación' })
    crear(@Body() dto: CrearOcupacion1Dto) {
        return this.ocupacion1Service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las ocupaciones' })
    obtenerTodos() {
        return this.ocupacion1Service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener una ocupación por ID' })
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.ocupacion1Service.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar una ocupación por ID' })
    actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarOcupacion1Dto) {
        return this.ocupacion1Service.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar una ocupación por ID' })
    eliminar(@Param('id', ParseIntPipe) id: number) {
        return this.ocupacion1Service.eliminar(id);
    }
}
