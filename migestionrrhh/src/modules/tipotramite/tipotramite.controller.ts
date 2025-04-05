import { Controller, Post, Get, Param, Put, Patch, Delete, Body } from '@nestjs/common';
import { TipotramiteService } from './tipotramite.service';
import { CrearTipoTramiteDto } from './dto/crear-tipotramite.dto';
import { ActualizarTipoTramiteDto } from './dto/actualizar-tipotramite.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
@ApiTags('tipotramite')
@UseGuards(JwtAuthGuard)

@Controller('tipotramite')
export class TipotramiteController {
    constructor(private readonly tipoTramiteService: TipotramiteService) { }

    @Post()
    @ApiOperation({ summary: 'Crear un nuevo tipo de trámite' })
    crear(@Body() data: CrearTipoTramiteDto) {
        return this.tipoTramiteService.crear(data);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los tipos de trámite' })
    obtenerTodos() {
        return this.tipoTramiteService.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener tipo de trámite por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.tipoTramiteService.obtenerPorId(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un tipo de trámite' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarTipoTramiteDto) {
        return this.tipoTramiteService.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar un tipo de trámite por ID' })
    eliminar(@Param('id') id: number) {
        return this.tipoTramiteService.eliminar(id);
    }
}
