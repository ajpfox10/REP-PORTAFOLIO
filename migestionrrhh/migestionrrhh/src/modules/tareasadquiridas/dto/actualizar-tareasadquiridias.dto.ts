import { PartialType } from '@nestjs/swagger';
import { CrearTareasadquiridiasDto } from './crear-tareasadquiridias.dto';

export class ActualizarTareasadquiridiasDto extends PartialType(CrearTareasadquiridiasDto) { }
