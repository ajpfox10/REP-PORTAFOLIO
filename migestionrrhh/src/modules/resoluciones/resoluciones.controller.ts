import { Controller, Post, Get, Body } from '@nestjs/common';
import { ResolucionesService } from './resoluciones.service';
import { CrearResolucionDto } from './dto/resoluciones.dto';


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
}