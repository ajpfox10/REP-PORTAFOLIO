import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearResolucionDto {
    @ApiProperty({ example: 'Resolución Nº 1234/2024', description: 'Texto completo de la resolución' })
    @IsString()
    @IsNotEmpty()
    resolucion!: string;

    @ApiProperty({ example: 'admin', description: 'Usuario que registra la resolución' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
