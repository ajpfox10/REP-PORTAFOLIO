import { PartialType } from '@nestjs/swagger';
import { CrearScaneardocumentacionDto } from './crear-scaneardocumentacion.dto';

export class ActualizarScaneardocumentacionDto extends PartialType(CrearScaneardocumentacionDto) { }
