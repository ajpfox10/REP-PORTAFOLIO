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
import { CccoodegdebaService } from './cccoodegdeba.service';
import { CrearCccoodegdebaDto } from './dto/cccoodegdeba.dto';
import { ActualizarCccoodegdebaDto } from './dto/actualizar-cccoodegdeba.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('cccoodegdeba')
@ApiBearerAuth()
@Controller('cccoodegdeba')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CccoodegdebaController {
    constructor(private readonly service: CccoodegdebaService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear un nuevo registro de cccoodegdeba' })
    crear(@Body() dto: CrearCccoodegdebaDto) {
        return this.service.crear(dto);
    }

    @Get()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener todos los registros de cccoodegdeba' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Obtener un registro de cccoodegdeba por ID' })
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar un registro de cccoodegdeba por ID' })
    actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarCccoodegdebaDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar un registro de cccoodegdeba por ID' })
    eliminar(@Param('id', ParseIntPipe) id: number) {
        return this.service.eliminar(id);
    }
}
