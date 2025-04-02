// src/modules/ocupacion1/ocupacion1.controller.ts

import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { Ocupacion1Service } from './ocupacion1.service';
import { CrearOcupacion1Dto } from './dto/crear-ocupacion1.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';

@Controller('ocupacion1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class Ocupacion1Controller {
    constructor(private readonly ocupacion1Service: Ocupacion1Service) { }

    @Post()
    @Roles(Rol.ADMIN)
    crear(@Body() dto: CrearOcupacion1Dto) {
        return this.ocupacion1Service.crear(dto);
    }

    @Get()
    obtenerTodos() {
        return this.ocupacion1Service.obtenerTodos();
    }

    @Get(':id')
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.ocupacion1Service.obtenerPorId(id);
    }
}
