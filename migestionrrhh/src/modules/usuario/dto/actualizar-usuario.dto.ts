import { PartialType } from '@nestjs/swagger';
import { CreateUsuarioDto } from './usuario.dto';

export class ActualizarUsuarioDto extends PartialType(CreateUsuarioDto) { }
