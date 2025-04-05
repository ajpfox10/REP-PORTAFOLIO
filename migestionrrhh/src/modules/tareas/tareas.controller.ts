import { Controller, Post, Body, Get, Param, Delete, Req } from '@nestjs/common';
import { TareasService } from './tareas.service';
import { CrearTareasDto } from './dto/crear-tareas.dto';
import { Put, Patch } from '@nestjs/common';
import { ActualizarTareasDto } from './dto/actualizar-tareas.dto';
import { ApiOperation } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { ApiTags } from '@nestjs/swagger';


@ApiTags('tareas')
@UseGuards(JwtAuthGuard)

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
    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una tarea' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarTareasDto) {
        return this.tareasService.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una tarea por ID' })
    eliminar(@Param('id') id: number) {
        return this.tareasService.eliminar(id);
    }   
}