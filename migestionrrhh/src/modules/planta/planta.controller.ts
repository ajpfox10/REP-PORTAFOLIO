import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Delete,
    Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PlantaService } from './planta.service';
import { CrearPlantaDto } from './dto/crear-planta.dto';
import { ActualizarPlantaDto } from './dto/actualizar-planta.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';

@ApiTags('planta')
@UseGuards(JwtAuthGuard)

@Controller('planta')
export class PlantaController {
    constructor(private readonly service: PlantaService) { }

    @Post()
    @ApiOperation({ summary: 'Crear una nueva planta' })
    crear(@Body() dto: CrearPlantaDto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todas las plantas' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener una planta por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar una planta por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarPlantaDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar una planta por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
