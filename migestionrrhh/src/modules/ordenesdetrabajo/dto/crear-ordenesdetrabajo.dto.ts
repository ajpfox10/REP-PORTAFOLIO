import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearOrdenesdetrabajoDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    descripcion!: string;
}
