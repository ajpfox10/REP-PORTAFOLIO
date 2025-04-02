import { Controller, Post, Body, Get, Param, Req, Delete } from '@nestjs/common';
import { TareasadquiridiasService } from './tareasadquiridias.service';
import { CrearTareasadquiridiasDto } from './dto/crear-tareasadquiridias.dto';

@Controller('tareasadquiridias')
export class TareasadquiridiasController {
    constructor(private readonly tareasadquiridiasService: TareasadquiridiasService) { }

    @Post()
    async crear(@Body() dto: CrearTareasadquiridiasDto, @Req() req: any) {
        const usuario = req.user?.usuario || 'sistema';
        return this.tareasadquiridiasService.crear(dto, usuario);
    }

    @Get()
    async obtenerTodos() {
        return this.tareasadquiridiasService.obtenerTodos();
    }

    @Get(':id')
    async obtenerPorId(@Param('id') id: number) {
        return this.tareasadquiridiasService.obtenerPorId(id);
    }

    @Delete(':id')
    async eliminar(@Param('id') id: number) {
        return this.tareasadquiridiasService.eliminar(id);
    }
}