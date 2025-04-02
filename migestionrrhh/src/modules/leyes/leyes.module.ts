import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Ley } from './leyes.model';
import { LeyesService } from './leyes.service';
import { LeyesController } from './leyes.controller';

@Module({
    imports: [SequelizeModule.forFeature([Ley])],
    controllers: [LeyesController],
    providers: [LeyesService],
})
export class LeyesModule {}
