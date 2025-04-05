import { PartialType } from '@nestjs/swagger';
import { CrearCargosDeInicioDto } from './cargosdeinicio.dto';

export class ActualizarCargosDeInicioDto extends PartialType(CrearCargosDeInicioDto) { }
