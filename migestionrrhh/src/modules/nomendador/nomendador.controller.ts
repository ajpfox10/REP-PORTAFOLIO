import { Controller, Post, Get, Param, Body, Delete } from '@nestjs/common';
import { NomendadorService } from './nomendador.service';
import { CrearNomendadorDto } from './dto/crear-nomendador.dto';

@Controller('nomendador')
export class NomendadorController {
  constructor(private readonly service: NomendadorService) {}

  @Post()
  crear(@Body() dto: CrearNomendadorDto) {
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