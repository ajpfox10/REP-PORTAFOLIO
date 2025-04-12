import { PartialType } from '@nestjs/swagger';
import { CrearPedidosDto } from './crear-pedidos.dto';

export class ActualizarPedidosDto extends PartialType(CrearPedidosDto) { }
