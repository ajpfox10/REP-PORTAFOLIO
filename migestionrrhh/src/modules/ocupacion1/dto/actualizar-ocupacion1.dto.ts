import { PartialType } from '@nestjs/swagger';
import { CrearOcupacion1Dto } from './crear-ocupacion1.dto';

export class ActualizarOcupacion1Dto extends PartialType(CrearOcupacion1Dto) { }
