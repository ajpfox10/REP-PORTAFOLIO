import { PartialType } from '@nestjs/swagger';
import { CrearLeyDto } from './crear-ley.dto';

export class ActualizarLeyDto extends PartialType(CrearLeyDto) { }
