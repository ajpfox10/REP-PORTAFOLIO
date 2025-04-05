import {
    Controller,
    Post,
    Body,
    Get,
    Param,
    Patch,
    Delete,
} from '@nestjs/common';
import { OrdenesdetrabajoService } from './ordenesdetrabajo.service';
import { CrearOrdenesdetrabajoDto } from './dto/crear-ordenesdetrabajo.dto';
import { ActualizarOrdenesdetrabajoDto } from './dto/actualizar-ordenesdetrabajo.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';

@ApiTags('ordenesdetrabajo')
@UseGuards(JwtAuthGuard)
@Controller('ordenesdetrabajo')
export class OrdenesdetrabajoController {
    constructor(private readonly service: OrdenesdetrabajoService) { }

    @Post()
    @ApiOperation({ summary: 'Crear una orden de trabajo' })
    crear(@Body() dto: CrearOrdenesdetrabajoDto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las órdenes de trabajo' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener una orden de trabajo por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una orden de trabajo por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarOrdenesdetrabajoDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una orden de trabajo por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
