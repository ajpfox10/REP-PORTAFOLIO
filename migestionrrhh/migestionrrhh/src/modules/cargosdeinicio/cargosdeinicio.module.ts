// Módulo principal para cargosdeinicio
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Cargosdeinicio } from './cargosdeinicio.model';
import { CargosdeinicioController } from './cargosdeinicio.controller';
import { CargosdeinicioService } from './cargosdeinicio.service';

@Module({
    imports: [SequelizeModule.forFeature([Cargosdeinicio])],
    controllers: [CargosdeinicioController],
    providers: [CargosdeinicioService],
})
export class CargosdeinicioModule { }
