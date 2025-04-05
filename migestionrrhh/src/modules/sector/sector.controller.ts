import { Controller, Post, Get, Param, Body, Delete, Patch } from '@nestjs/common';
import { SectorService } from './sector.service';
import { CrearSectorDto } from './dto/crear-sector.dto';
import { ActualizarSectorDto } from './dto/actualizar-sector.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';

@ApiTags('sector')
@UseGuards(JwtAuthGuard)

@Controller('sector')
export class SectorController {
    constructor(private readonly sectorService: SectorService) { }

    @Post()
    @ApiOperation({ summary: 'Crear un sector' })
    crear(@Body() dto: CrearSectorDto) {
        return this.sectorService.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todos los sectores' })
    obtenerTodos() {
        return this.sectorService.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener un sector por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.sectorService.obtenerPorId(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar un sector' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarSectorDto) {
        return this.sectorService.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar un sector' })
    eliminar(@Param('id') id: number) {
        return this.sectorService.eliminar(id);
    }
}
