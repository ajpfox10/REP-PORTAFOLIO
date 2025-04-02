import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Rangoshorarios } from './rangoshorarios.model';
import { RangoshorariosService } from './rangoshorarios.service';
import { RangoshorariosController } from './rangoshorarios.controller';

@Module({
  imports: [SequelizeModule.forFeature([Rangoshorarios])],
  controllers: [RangoshorariosController],
  providers: [RangoshorariosService],
})
export class RangoshorariosModule {}