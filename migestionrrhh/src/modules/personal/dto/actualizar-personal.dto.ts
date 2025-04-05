import { PartialType } from '@nestjs/swagger';
import { CreatePersonalDto } from './personal.dto';

export class ActualizarPersonalDto extends PartialType(CreatePersonalDto) { }
