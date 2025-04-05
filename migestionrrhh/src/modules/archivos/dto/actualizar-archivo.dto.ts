import { PartialType } from '@nestjs/swagger';
import { CrearArchivoDto } from './crear-archivo.dto';

export class ActualizarArchivoDto extends PartialType(CrearArchivoDto) { }
