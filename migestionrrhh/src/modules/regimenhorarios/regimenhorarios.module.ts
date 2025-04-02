import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Regimenhorarios } from './regimenhorarios.model';
import { RegimenhorariosService } from './regimenhorarios.service';
import { RegimenhorariosController } from './regimenhorarios.controller';

@Module({
  imports: [SequelizeModule.forFeature([Regimenhorarios])],
  controllers: [RegimenhorariosController],
  providers: [RegimenhorariosService],
})
export class RegimenhorariosModule {}