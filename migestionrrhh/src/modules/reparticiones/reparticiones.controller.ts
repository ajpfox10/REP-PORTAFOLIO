import {
    Controller,
    Get,
    Param,
    Patch,
    Delete,
    Body,
    UseGuards,
} from '@nestjs/common';
import { ReparticionesService } from './reparticiones.service';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ActualizarReparticionesDto } from './dto/actualizar-reparticiones.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('reparticiones')
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

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una repartición por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarReparticionesDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una repartición por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
