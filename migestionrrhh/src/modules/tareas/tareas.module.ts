import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Tareas } from './tareas.model';
import { TareasService } from './tareas.service';
import { TareasController } from './tareas.controller';

@Module({
  imports: [SequelizeModule.forFeature([Tareas])],
  providers: [TareasService],
  controllers: [TareasController],
})
export class TareasModule {}