import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearResolucionDto {
    @ApiProperty({ example: 'Resolución Nº 1234/2024', description: 'Texto completo de la resolución' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(500, { message: 'La resolución no puede exceder los 500 caracteres' })
    resolucion!: string;

    @ApiProperty({ example: 'admin', description: 'Usuario que registra la resolución' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(500, { message: 'La resolución no puede exceder los 500 caracteres' })
    usuarioCarga!: string;
}
