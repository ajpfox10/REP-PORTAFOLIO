import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearResolucionDto {
    @ApiProperty({ example: 'Resoluci�n N� 1234/2024', description: 'Texto completo de la resoluci�n' })
    @IsString()
    @IsNotEmpty()
    resolucion!: string;

    @ApiProperty({ example: 'admin', description: 'Usuario que registra la resoluci�n' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
