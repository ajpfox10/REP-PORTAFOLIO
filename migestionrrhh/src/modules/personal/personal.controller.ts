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
import { PersonalService } from './personal.service';
import { CreatePersonalDto } from './dto/personal.dto';
import { ActualizarPersonalDto } from './dto/actualizar-personal.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';

@ApiTags('personal')

@UseGuards(JwtAuthGuard)

@Controller('personal')
export class PersonalController {
    constructor(private readonly service: PersonalService) { }

    @Post()
    @ApiOperation({ summary: 'Crear nuevo personal' })
    crear(@Body() dto: CreatePersonalDto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todo el personal' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener personal por ID' })
    obtenerPorId(@Param('id') id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar datos del personal por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarPersonalDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar personal por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
