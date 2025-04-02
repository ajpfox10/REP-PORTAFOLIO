import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ReparticionesService } from './reparticiones.service';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';

@Controller('reparticiones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReparticionesController {
    constructor(private readonly service: ReparticionesService) { }

    @Get()
    @Roles(Rol.ADMIN, Rol.USER)
    async obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @Roles(Rol.ADMIN, Rol.USER)
    async obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }
}
