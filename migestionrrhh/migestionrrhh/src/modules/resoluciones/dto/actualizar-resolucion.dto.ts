import { PartialType } from '@nestjs/swagger';
import { CrearResolucionDto } from './crear-resolucion.dto';

export class ActualizarResolucionDto extends PartialType(CrearResolucionDto) { }
