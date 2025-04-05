import { PartialType } from '@nestjs/swagger';
import { CrearCcDto } from './cc.dto';

export class ActualizarCcDto extends PartialType(CrearCcDto) { }
