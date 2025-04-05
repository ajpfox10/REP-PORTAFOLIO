import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearResolucionDto {
    @ApiProperty({ example: 'Resoluci�n N� 1234/2024', description: 'Texto completo de la resoluci�n' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(500, { message: 'La resoluci�n no puede exceder los 500 caracteres' })
    resolucion!: string;

    @ApiProperty({ example: 'admin', description: 'Usuario que registra la resoluci�n' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(500, { message: 'La resoluci�n no puede exceder los 500 caracteres' })
    usuarioCarga!: string;
}
