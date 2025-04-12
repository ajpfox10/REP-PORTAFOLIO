import { PartialType } from '@nestjs/swagger';
import { CrearRangoshorariosDto } from './crear-rangoshorarios.dto';

export class ActualizarRangoshorariosDto extends PartialType(CrearRangoshorariosDto) { }
