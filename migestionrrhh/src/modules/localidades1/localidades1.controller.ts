import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Delete,
    Patch,
} from '@nestjs/common';
import { Localidades1Service } from './localidades1.service';
import { CrearLocalidades1Dto } from './dto/crear-localidades1.dto';
import { ActualizarLocalidades1Dto } from './dto/actualizar_localidades1.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';

@ApiTags('localidades1')
@UseGuards(JwtAuthGuard)
@Controller('localidades1')
export class Localidades1Controller {
    constructor(private readonly service: Localidades1Service) { }

    @Post()
    @ApiOperation({ summary: 'Crear una nueva localidad' })
    crear(@Body() dto: CrearLocalidades1Dto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las localidades' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener una localidad por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una localidad por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarLocalidades1Dto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una localidad por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
