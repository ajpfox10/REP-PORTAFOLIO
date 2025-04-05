import {
    Controller,
    Get,
    Param,
    Delete,
    UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SexoService } from './sexo.service';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { Patch } from '@nestjs/common';
import { ActualizarSexoDto } from './dto/actualizar-sexo.dto';
import { ApiOperation } from '@nestjs/swagger';
import { Body } from '@nestjs/common';

@ApiTags('sexo')
@Controller('sexo')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SexoController {
    constructor(private readonly sexoService: SexoService) { }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un sexo por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarSexoDto) {
        return this.sexoService.actualizar(id, dto);
    }



    @Get()
    @Roles(Rol.ADMIN)
    obtenerTodos() {
        return this.sexoService.obtenerTodos();
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    obtenerPorId(@Param('id') id: number) {
        return this.sexoService.obtenerPorId(id);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    eliminar(@Param('id') id: number) {
        return this.sexoService.eliminar(id);
    }
}
