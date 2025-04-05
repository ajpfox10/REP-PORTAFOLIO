import { PartialType } from '@nestjs/swagger';
import { CrearNomendadorDto } from './crear-nomendador.dto';

export class ActualizarNomendadorDto extends PartialType(CrearNomendadorDto) { }
