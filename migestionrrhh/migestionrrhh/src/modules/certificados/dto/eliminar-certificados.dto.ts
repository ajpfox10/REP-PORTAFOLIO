import { IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EliminarCertificadoDto {
    @ApiProperty({ example: 1 })
    @IsInt()
    id!: number;
}
