import { Tblarchivos } from './tblarchivos.model';
import { TblarchivosService } from './tblarchivos.service';
import { TblarchivosController } from './tblarchivos.controller';

import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

@Module({
    imports: [SequelizeModule.forFeature([Tblarchivos])],
    providers: [TblarchivosService],
    controllers: [TblarchivosController],
})
export class TblarchivosModule { }
