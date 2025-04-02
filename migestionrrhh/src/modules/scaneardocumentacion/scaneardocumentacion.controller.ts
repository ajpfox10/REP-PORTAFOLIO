import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { ScaneardocumentacionService } from './scaneardocumentacion.service';
import { CrearScaneardocumentacionDto } from './dto/crear-scaneardocumentacion.dto';

@Controller('scaneardocumentacion')
export class ScaneardocumentacionController {
    constructor(private readonly service: ScaneardocumentacionService) { }

    @Post()
    crear(@Body() dto: CrearScaneardocumentacionDto) {
        return this.service.crear(dto);
    }

    @Get()
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }

    @Delete(':id')
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
