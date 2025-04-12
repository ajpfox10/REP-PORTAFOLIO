import { PartialType } from '@nestjs/swagger';
import { CrearRegimenhorariosDto } from './crear-regimenhorarios.dto';

export class ActualizarRegimenhorariosDto extends PartialType(CrearRegimenhorariosDto) { }
