import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Delete,
    ParseIntPipe,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { Localidades1Service } from './localidades1.service';
import { CrearLocalidades1Dto } from './dto/crear-localidades1.dto';

@Controller('localidades1')
export class Localidades1Controller {
    constructor(private readonly service: Localidades1Service) { }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    crear(@Body() dto: CrearLocalidades1Dto) {
        return this.service.crear(dto);
    }

    @Get()
    obtenerTodos() {
        return this.service.obtenerTodos();
    }

    @Get(':id')
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.service.obtenerPorId(id);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    eliminar(@Param('id', ParseIntPipe) id: number) {
        return this.service.eliminar(id);
    }
}
