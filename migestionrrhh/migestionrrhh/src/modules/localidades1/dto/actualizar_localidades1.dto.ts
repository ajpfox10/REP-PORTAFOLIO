import { PartialType } from '@nestjs/swagger';
import { CrearLocalidades1Dto } from './crear-localidades1.dto';

export class ActualizarLocalidades1Dto extends PartialType(CrearLocalidades1Dto) { }
