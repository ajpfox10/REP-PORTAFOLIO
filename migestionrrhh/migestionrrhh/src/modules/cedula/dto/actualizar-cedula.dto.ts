import { PartialType } from '@nestjs/swagger';
import { CrearCedulaDto } from './cedula.dto';

export class ActualizarCedulaDto extends PartialType(CrearCedulaDto) { }
