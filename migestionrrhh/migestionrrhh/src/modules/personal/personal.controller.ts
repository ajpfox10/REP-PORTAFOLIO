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
    Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PersonalService } from './personal.service';
import { CreatePersonalDto } from './dto/personal.dto';
import { ActualizarPersonalDto } from './dto/actualizar-personal.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import * as Sentry from '@sentry/node';

@ApiTags('personal')
@UseGuards(JwtAuthGuard)
@Controller('personal')
export class PersonalController {
    private readonly logger = new Logger(PersonalController.name);

    constructor(private readonly service: PersonalService) { }

    @Post()
    @ApiOperation({ summary: 'Crear nuevo personal' })
    async crear(@Body() dto: CreatePersonalDto) {
        try {
            this.logger.log('Creando personal...');
            return await this.service.crear(dto);
        } catch (error) {
            this.logger.error('Error al crear personal', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get()
    @ApiOperation({ summary: 'Obtener todo el personal' })
    async obtenerTodos() {
        try {
            this.logger.log('Obteniendo todos los personales...');
            return await this.service.obtenerTodos();
        } catch (error) {
            this.logger.error('Error al obtener personales', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener personal por ID' })
    async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Obteniendo personal ID: ${id}`);
            return await this.service.obtenerPorId(id);
        } catch (error) {
            this.logger.error(`Error al obtener personal ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Actualizar personal' })
    async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarPersonalDto) {
        try {
            this.logger.log(`Actualizando personal ID: ${id}`);
            return await this.service.actualizar(id, dto);
        } catch (error) {
            this.logger.error(`Error al actualizar personal ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Eliminar personal' })
    async eliminar(@Param('id', ParseIntPipe) id: number) {
        try {
            this.logger.log(`Eliminando personal ID: ${id}`);
            return await this.service.eliminar(id);
        } catch (error) {
            this.logger.error(`Error al eliminar personal ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}

