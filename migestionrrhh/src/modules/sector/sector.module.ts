import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Sector } from './sector.model';
import { SectorService } from './sector.service';
import { SectorController } from './sector.controller';

@Module({
  imports: [SequelizeModule.forFeature([Sector])],
  controllers: [SectorController],
  providers: [SectorService],
})
export class SectorModule {}