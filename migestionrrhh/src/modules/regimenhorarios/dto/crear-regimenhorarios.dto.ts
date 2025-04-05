import { IsString, IsOptional, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearRegimenhorariosDto {
    @ApiProperty({
        example: 'Régimen semanal',
        description: 'Nombre del régimen horario',
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre del régimen es obligatorio' })
    @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
    nombre!: string;

    @ApiPropertyOptional({
        example: 'admin',
        description: 'Usuario que realiza la carga (opcional)',
    })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsOptional()
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga?: string;
}
