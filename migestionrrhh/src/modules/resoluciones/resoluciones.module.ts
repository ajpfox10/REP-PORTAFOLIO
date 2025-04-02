import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Resolucion } from './resoluciones.model';
import { ResolucionesService } from './resoluciones.service';
import { ResolucionesController } from './resoluciones.controller';

@Module({
    imports: [SequelizeModule.forFeature([Resolucion])],
    controllers: [ResolucionesController],
    providers: [ResolucionesService],
    exports: [ResolucionesService]
})
export class ResolucionesModule {}