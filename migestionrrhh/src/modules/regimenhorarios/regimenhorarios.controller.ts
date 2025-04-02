import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { RegimenhorariosService } from './regimenhorarios.service';
import { CrearRegimenhorariosDto } from './dto/crear-regimenhorarios.dto';

@Controller('regimenhorarios')
export class RegimenhorariosController {
    constructor(private readonly service: RegimenhorariosService) { }

    @Post()
    crear(@Body() dto: CrearRegimenhorariosDto) {
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
