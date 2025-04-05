import { PartialType } from '@nestjs/swagger';
import { CrearReparticionesDto } from './crear-reparticiones.dto';

export class ActualizarReparticionesDto extends PartialType(CrearReparticionesDto) { }
