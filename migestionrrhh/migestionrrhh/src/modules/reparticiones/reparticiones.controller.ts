import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { ReparticionesService } from './reparticiones.service';
import { CrearReparticionesDto } from './dto/crear-reparticiones.dto';
import { ActualizarReparticionesDto } from './dto/actualizar-reparticiones.dto';
import { Reparticiones } from './reparticiones.model';

@Controller('reparticiones')
export class ReparticionesController {
    constructor(private readonly service: ReparticionesService) { }

    @Get()
    async obtenerTodos(): Promise<Reparticiones[]> {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    async obtenerPorId(@Param('id') id: number): Promise<Reparticiones> {
        return this.service.obtenerPorId(id);
    }

    @Post()
    async crear(@Body() dto: CrearReparticionesDto): Promise<Reparticiones> {
        return this.service.crear(dto);
    }

    @Put(':id')
    async actualizar(
        @Param('id') id: number,
        @Body() dto: ActualizarReparticionesDto
    ): Promise<Reparticiones> {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    async eliminar(@Param('id') id: number): Promise<boolean> {
        return this.service.eliminar(id);
    }
}