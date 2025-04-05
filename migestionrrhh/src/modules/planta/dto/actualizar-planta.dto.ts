import { PartialType } from '@nestjs/swagger';
import { CrearPlantaDto } from './crear-planta.dto';

export class ActualizarPlantaDto extends PartialType(CrearPlantaDto) { }
