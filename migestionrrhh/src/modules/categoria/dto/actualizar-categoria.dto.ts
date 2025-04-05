import { PartialType } from '@nestjs/swagger';
import { CrearCategoriaDto } from './categoria.dto';

export class ActualizarCategoriaDto extends PartialType(CrearCategoriaDto) { }
