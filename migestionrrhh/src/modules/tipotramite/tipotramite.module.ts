// src/modules/tipotramite/tipotramite.module.ts

import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { TipoTramite } from './tipotramite.model';
import { TipotramiteService } from './tipotramite.service';
import { TipotramiteController } from './tipotramite.controller';

@Module({
    imports: [SequelizeModule.forFeature([TipoTramite])],
    controllers: [TipotramiteController],
    providers: [TipotramiteService],
    exports: [TipotramiteService],
})
export class TipotramiteModule { }
