import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { TblArchivos } from './tblarchivos.model';
import { TblArchivosService } from './tblarchivos.service';
import { TblArchivosController } from './tblarchivos.controller';

@Module({
    imports: [SequelizeModule.forFeature([TblArchivos])],
    providers: [TblArchivosService],
    controllers: [TblArchivosController],
})
export class TblArchivosModule {}