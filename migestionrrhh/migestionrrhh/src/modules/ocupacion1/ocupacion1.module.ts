import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Ocupacion1 } from './ocupacion1.model';
import { Ocupacion1Service } from './ocupacion1.service';
import { Ocupacion1Controller } from './ocupacion1.controller';

@Module({
  imports: [SequelizeModule.forFeature([Ocupacion1])],
  controllers: [Ocupacion1Controller],
  providers: [Ocupacion1Service],
})
export class Ocupacion1Module {}