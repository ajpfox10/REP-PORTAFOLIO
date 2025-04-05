import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Delete,
    Patch,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { CertificadosService } from './certificados.service';
import { CrearCertificadosDto } from './dto/certificados.dto';
import { ActualizarCertificadoDto } from './dto/actualizar-certificado.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('certificados')
@Controller('certificados')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CertificadosController {
    constructor(private readonly service: CertificadosService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear certificado' })
    crear(@Body() dto: CrearCertificadosDto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Listar certificados' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener certificado por ID' })
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar certificado por ID' })
    actualizar(@Param('id') id: number, @Body() dto: ActualizarCertificadoDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar certificado por ID' })
    eliminar(@Param('id') id: number) {
        return this.service.eliminar(id);
    }
}
