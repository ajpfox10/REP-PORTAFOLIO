import { Controller, Post, Get, Param, Body, Delete } from '@nestjs/common';
import { MinisteriosService } from './ministerios.service';
import { CrearMinisteriosDto } from './dto/crear-ministerios.dto';

@Controller('ministerios')
export class MinisteriosController {
  constructor(private readonly service: MinisteriosService) {}

  @Post()
  crear(@Body() dto: CrearMinisteriosDto) {
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