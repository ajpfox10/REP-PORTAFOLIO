import { Controller, Post, Get, Param, Body, Delete } from '@nestjs/common';
import { LeyesService } from './leyes.service';
import { CrearLeyDto } from './dto/crear-ley.dto';


@Controller('leyes')
export class LeyesController {
    constructor(private readonly leyesService: LeyesService) {}

    @Post()
    crear(@Body() dto: CrearLeyDto) {
        return this.leyesService.crearLey(dto);
    }

    @Get()
    listar() {
        return this.leyesService.obtenerTodas();
    }

    @Get(':id')
    obtener(@Param('id') id: number) {
        return this.leyesService.obtenerPorId(id);
    }

    @Delete(':id')
    eliminar(@Param('id') id: number) {
        return this.leyesService.eliminar(id);
    }
}
