import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Localidades1 } from './localidades1.model';
import { Localidades1Service } from './localidades1.service';
import { Localidades1Controller } from './localidades1.controller';

@Module({
  imports: [SequelizeModule.forFeature([Localidades1])],
  controllers: [Localidades1Controller],
  providers: [Localidades1Service],
})
export class Localidades1Module {}