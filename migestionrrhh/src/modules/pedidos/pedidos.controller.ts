import {
    Controller,
    Get,
    Param,
    NotFoundException,
    UseGuards,
} from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';

@Controller('pedidos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PedidosController {
    constructor(private readonly pedidosService: PedidosService) { }

    @Get(':id')
    @Roles(Rol.ADMIN, Rol.USER)
    async buscarPorId(@Param('id') id: number) {
        const pedido = await this.pedidosService.obtenerPorId(id);
        if (!pedido) {
            throw new NotFoundException('Pedido no encontrado');
        }
        return pedido;
    }
}
