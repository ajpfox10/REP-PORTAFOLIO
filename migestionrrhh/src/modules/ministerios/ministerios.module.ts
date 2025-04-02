import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Ministerios } from './ministerios.model';
import { MinisteriosService } from './ministerios.service';
import { MinisteriosController } from './ministerios.controller';

@Module({
  imports: [SequelizeModule.forFeature([Ministerios])],
  controllers: [MinisteriosController],
  providers: [MinisteriosService],
})
export class MinisteriosModule {}