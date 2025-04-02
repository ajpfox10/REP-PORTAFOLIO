import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Tareasadquiridias } from './tareasadquiridias.model';
import { TareasadquiridiasService } from './tareasadquiridias.service';
import { TareasadquiridiasController } from './tareasadquiridias.controller';

@Module({
    imports: [SequelizeModule.forFeature([Tareasadquiridias])],
    providers: [TareasadquiridiasService],
    controllers: [TareasadquiridiasController],
})
export class TareasadquiridiasModule {}
