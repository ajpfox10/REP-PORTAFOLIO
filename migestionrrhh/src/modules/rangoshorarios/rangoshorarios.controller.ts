import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { RangoshorariosService } from './rangoshorarios.service';
import { CrearRangoshorariosDto } from './dto/crear-rangoshorarios.dto';

@Controller('rangoshorarios')
export class RangoshorariosController {
    constructor(private readonly rangoshorariosService: RangoshorariosService) { }

    @Post()
    async crear(@Body() data: CrearRangoshorariosDto) {
        return this.rangoshorariosService.crear(data);
    }

    @Get(':id')
    async buscar(@Param('id') id: number) {
        return this.rangoshorariosService.buscarPorId(id);
    }
}
