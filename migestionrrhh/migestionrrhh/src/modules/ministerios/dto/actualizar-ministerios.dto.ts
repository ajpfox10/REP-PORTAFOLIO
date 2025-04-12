import { PartialType } from '@nestjs/swagger';
import { CrearMinisteriosDto } from './crear-ministerios.dto';

export class ActualizarMinisteriosDto extends PartialType(CrearMinisteriosDto) { }
