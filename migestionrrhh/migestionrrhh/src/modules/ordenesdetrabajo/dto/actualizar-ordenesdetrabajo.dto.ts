import { PartialType } from '@nestjs/swagger';
import { CrearOrdenesdetrabajoDto } from './crear-ordenesdetrabajo.dto';

export class ActualizarOrdenesdetrabajoDto extends PartialType(CrearOrdenesdetrabajoDto) { }
