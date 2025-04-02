import { Controller, Post, Body, Get, Param, Put, Delete } from '@nestjs/common';
import { TblArchivosService } from './tblarchivos.service';
import { TblArchivos } from './tblarchivos.model';
import { CreationAttributes } from 'sequelize';

@Controller('archivos')
export class TblArchivosController {
    constructor(private readonly service: TblArchivosService) { }

    @Post()
    async create(@Body() data: CreationAttributes<TblArchivos>): Promise<TblArchivos> {
        return this.service.create(data);
    }

    @Get()
    findAll(): Promise<TblArchivos[]> {
        return this.service.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: number): Promise<TblArchivos> {
        return this.service.findOne(id);
    }

    @Put(':id')
    update(@Param('id') id: number, @Body() data: Partial<TblArchivos>): Promise<void> {
        return this.service.update(id, data);
    }

    @Delete(':id')
    delete(@Param('id') id: number): Promise<void> {
        return this.service.delete(id);
    }
}
