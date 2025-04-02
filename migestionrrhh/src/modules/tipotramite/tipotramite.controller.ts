// src/modules/tipotramite/tipotramite.controller.ts

import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { TipotramiteService } from './tipotramite.service';
import { CrearTipoTramiteDto } from './dto/crear-tipotramite.dto';

@Controller('tipotramite')
export class TipotramiteController {
    constructor(private readonly tipoTramiteService: TipotramiteService) { }

    @Post()
    crear(@Body() data: CrearTipoTramiteDto) {
        return this.tipoTramiteService.crear(data);
    }

    @Get()
    obtenerTodos() {
        return this.tipoTramiteService.obtenerTodos();
    }

    @Get(':id')
    obtenerPorId(@Param('id') id: number) {
        return this.tipoTramiteService.obtenerPorId(id);
    }

    @Put(':id')
    actualizar(@Param('id') id: number, @Body() data: CrearTipoTramiteDto) {
        return this.tipoTramiteService.actualizar(id, data);
    }

    @Delete(':id')
    eliminar(@Param('id') id: number) {
        return this.tipoTramiteService.eliminar(id);
    }
}
