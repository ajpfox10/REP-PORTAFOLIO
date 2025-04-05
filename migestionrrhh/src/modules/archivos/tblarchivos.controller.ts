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
import { TblarchivosService } from './tblarchivos.service';
import { CrearArchivoDto } from './dto/crear-archivo.dto';
import { ActualizarArchivoDto } from './dto/actualizar-archivo.dto';
import { EliminarArchivosDto } from './dto/eliminar-archivos.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Tblarchivos } from './tblarchivos.model';

@ApiTags('tblarchivos')
@Controller('tblarchivos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TblarchivosController {
    constructor(private readonly service: TblarchivosService) { }

    @Post()
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Crear archivo' })
    crear(@Body() dto: CrearArchivoDto) {
        return this.service.crear(dto);
    }

    @Get()
    @ApiOperation({ summary: 'Listar todos los archivos' })
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener archivo por ID' })
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.service.obtenerPorId(id);
    }

    @Patch(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Actualizar archivo por ID' })
    actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarArchivoDto) {
        return this.service.actualizar(id, dto);
    }

    @Delete(':id')
    @Roles(Rol.ADMIN)
    @ApiOperation({ summary: 'Eliminar archivo por ID' })
    eliminar(@Param('id', ParseIntPipe) id: number, @Body() dto: EliminarArchivosDto) {
        return this.service.eliminar(id, dto);
    }
}

