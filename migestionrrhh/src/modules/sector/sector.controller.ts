import { Controller, Post, Get, Param, Body, Delete } from '@nestjs/common';
import { SectorService } from './sector.service';
import { CrearSectorDto } from './dto/crear-sector.dto';

@Controller('sector')
export class SectorController {
  constructor(private readonly service: SectorService) {}

  @Post()
  crear(@Body() dto: CrearSectorDto) {
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