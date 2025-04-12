import { PartialType } from '@nestjs/swagger';
import { CrearTareasDto } from './crear-tareas.dto';

export class ActualizarTareasDto extends PartialType(CrearTareasDto) { }
