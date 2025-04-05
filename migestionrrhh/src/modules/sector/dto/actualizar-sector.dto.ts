import { PartialType } from '@nestjs/swagger';
import { CrearSectorDto } from './crear-sector.dto';

export class ActualizarSectorDto extends PartialType(CrearSectorDto) { }
