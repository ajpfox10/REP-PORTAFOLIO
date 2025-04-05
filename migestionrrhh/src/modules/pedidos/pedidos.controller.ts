import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { CrearPedidosDto } from './dto/crear-pedidos.dto';
import { ActualizarPedidosDto } from './dto/actualizar-pedidos.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';

@ApiTags('pedidos')
@UseGuards(JwtAuthGuard)
@Controller('pedidos')
export class PedidosController {
    constructor(private readonly service: PedidosService) { }

    @Post()
    @ApiOperation({ summary: 'Crear un pedido' })
    crear(@Body() dto: CrearPedidosDto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los pedidos' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener un pedido por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un pedido' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarPedidosDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar un pedido por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
