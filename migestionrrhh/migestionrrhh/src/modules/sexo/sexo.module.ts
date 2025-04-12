import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SexoController } from './sexo.controller';
import { SexoService } from './sexo.service';
import { Sexo } from './sexo.model';

@Module({
    imports: [SequelizeModule.forFeature([Sexo])],
    controllers: [SexoController],
    providers: [SexoService],
})
export class SexoModule { }
