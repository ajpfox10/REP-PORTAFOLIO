import { PartialType } from '@nestjs/swagger';
import { CrearCertificadosDto } from './certificados.dto';

export class ActualizarCertificadoDto extends PartialType(CrearCertificadosDto) { }

