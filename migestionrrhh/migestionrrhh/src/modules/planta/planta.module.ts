import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Planta } from './planta.model';
import { PlantaService } from './planta.service';
import { PlantaController } from './planta.controller';

@Module({
  imports: [SequelizeModule.forFeature([Planta])],
  controllers: [PlantaController],
  providers: [PlantaService],
})
export class PlantaModule {}