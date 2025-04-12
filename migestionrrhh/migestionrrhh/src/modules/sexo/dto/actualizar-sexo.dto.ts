import { PartialType } from '@nestjs/swagger';
import { CrearSexoDto } from './crear-sexo.dto';

export class ActualizarSexoDto extends PartialType(CrearSexoDto) {}
