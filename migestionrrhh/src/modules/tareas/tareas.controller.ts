import { Controller, Post, Body, Get, Param, Delete, Req } from '@nestjs/common';
import { TareasService } from './tareas.service';
import { CrearTareasDto } from './dto/crear-tareas.dto';

@Controller('tareas')
export class TareasController {
    constructor(private readonly tareasService: TareasService) { }

    @Post()
    async crear(@Body() dto: CrearTareasDto, @Req() req: any) {
        const usuario = req.user?.usuario || 'sistema';
        return this.tareasService.crear(dto, usuario);
    }

    @Get()
    async obtenerTodos() {
        return this.tareasService.obtenerTodos();
    }

    @Get(':id')
    async obtenerPorId(@Param('id') id: number) {
        return this.tareasService.obtenerPorId(id);
    }

    @Delete(':id')
    async eliminar(@Param('id') id: number) {
        return this.tareasService.eliminar(id);
    }
}