import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearLocalidades1Dto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    descripcion?: string;
}
