import { Controller, Post, Get, Body } from '@nestjs/common';
import { ResolucionesService } from './resoluciones.service';
import { CrearResolucionDto } from './dto/resoluciones.dto';
import { Patch, Delete } from '@nestjs/common';
import { ActualizarResolucionDto } from './dto/actualizar-resolucion.dto';
import { ApiOperation } from '@nestjs/swagger';
import { Param } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('resoluciones')

@UseGuards(JwtAuthGuard)

@Controller('resoluciones')
export class ResolucionesController {
    constructor(private readonly resolucionesService: ResolucionesService) {}

    @Post()
    async crear(@Body() dto: CrearResolucionDto) {
        return this.resolucionesService.crear(dto);
    }

    @Get()
    async obtenerTodas() {
        return this.resolucionesService.obtenerTodas();
    }
    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una resolución por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarResolucionDto) {
        return this.resolucionesService.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una resolución por ID' })
    eliminar(@Param('id') id: number) {
        return this.resolucionesService.eliminar(id);
    }

}