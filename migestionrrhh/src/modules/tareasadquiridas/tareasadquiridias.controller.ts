import { Controller, Post, Body, Get, Param, Req, Delete } from '@nestjs/common';
import { TareasadquiridiasService } from './tareasadquiridias.service';
import { CrearTareasadquiridiasDto } from './dto/crear-tareasadquiridias.dto';
import { Patch } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ActualizarTareasadquiridiasDto } from './dto/actualizar-tareasadquiridias.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { ApiTags } from '@nestjs/swagger';
@ApiTags('tareasadquiridas')
@UseGuards(JwtAuthGuard)
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



    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una tarea adquirida' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarTareasadquiridiasDto) {
        return this.tareasadquiridiasService.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una tarea adquirida por ID' })
    eliminar(@Param('id') id: number) {
        return this.tareasadquiridiasService.eliminar(id);
    }
}