import { PartialType } from '@nestjs/swagger';
import { CrearTipoTramiteDto } from './crear-tipotramite.dto';

export class ActualizarTipoTramiteDto extends PartialType(CrearTipoTramiteDto) { }
