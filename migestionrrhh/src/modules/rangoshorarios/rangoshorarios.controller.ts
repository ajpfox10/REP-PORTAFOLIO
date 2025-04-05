import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Patch,
    Delete,
} from '@nestjs/common';
import { RangoshorariosService } from './rangoshorarios.service';
import { CrearRangoshorariosDto } from './dto/crear-rangoshorarios.dto';
import { ActualizarRangoshorariosDto } from './dto/actualizar-rangoshorarios.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';

@ApiTags('rangoshorarios')
@UseGuards(JwtAuthGuard)

@Controller('rangoshorarios')
export class RangoshorariosController {
    constructor(private readonly service: RangoshorariosService) { }

    @Post()
    @ApiOperation({ summary: 'Crear un nuevo rango horario' })
    crear(@Body() dto: CrearRangoshorariosDto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los rangos horarios' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener un rango horario por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id); // ? Usá el nombre correcto
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un rango horario por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarRangoshorariosDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar un rango horario por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
