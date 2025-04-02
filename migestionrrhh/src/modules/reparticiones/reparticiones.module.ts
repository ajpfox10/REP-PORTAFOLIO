import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Reparticiones } from './reparticiones.model';
import { ReparticionesService } from './reparticiones.service';
import { ReparticionesController } from './reparticiones.controller';

@Module({
    imports: [SequelizeModule.forFeature([Reparticiones])],
    controllers: [ReparticionesController],
    providers: [ReparticionesService],
})
export class ReparticionesModule { }
