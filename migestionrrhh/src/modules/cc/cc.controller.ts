// src/modules/cc/cc.controller.ts

import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Patch,
    Delete,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { CcService } from './cc.service';
import { CrearCcDto } from './dto/cc.dto';
import { ActualizarCcDto } from './dto/actualizar-cc.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('cc')
@ApiBearerAuth()
@Controller('cc')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CcController {
    constructor(private readonly ccService: CcService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo CC (solo admin)' })
    crear(@Body() dto: CrearCcDto) {
        return this.ccService.crear(dto);
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener todos los CC (solo admin)' })
    obtenerTodos() {
        return this.ccService.obtenerTodos();
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener un CC por ID (solo admin)' })
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.ccService.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar un CC por ID (solo admin)' })
    actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarCcDto) {
        return this.ccService.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un CC por ID (solo admin)' })
    eliminar(@Param('id', ParseIntPipe) id: number) {
        return this.ccService.eliminar(id);
    }
}
