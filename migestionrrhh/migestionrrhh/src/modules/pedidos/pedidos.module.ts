import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Pedidos } from './pedidos.model';
import { PedidosService } from './pedidos.service';
import { PedidosController } from './pedidos.controller';

@Module({
  imports: [SequelizeModule.forFeature([Pedidos])],
  controllers: [PedidosController],
  providers: [PedidosService],
})
export class PedidosModule {}