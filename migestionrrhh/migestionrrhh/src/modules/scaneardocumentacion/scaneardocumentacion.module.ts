import { Module } from '@nestjs/common';
import { ScaneardocumentacionService } from './scaneardocumentacion.service';
import { ScaneardocumentacionController } from './scaneardocumentacion.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { Scaneardocumentacion } from './scaneardocumentacion.model';

@Module({
    imports: [SequelizeModule.forFeature([Scaneardocumentacion])],
    controllers: [ScaneardocumentacionController],
    providers: [ScaneardocumentacionService],
})
export class ScaneardocumentacionModule { }
