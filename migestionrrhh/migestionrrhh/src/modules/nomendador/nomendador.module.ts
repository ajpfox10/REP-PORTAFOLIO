import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Nomendador } from './nomendador.model';
import { NomendadorService } from './nomendador.service';
import { NomendadorController } from './nomendador.controller';

@Module({
  imports: [SequelizeModule.forFeature([Nomendador])],
  controllers: [NomendadorController],
  providers: [NomendadorService],
})
export class NomendadorModule {}