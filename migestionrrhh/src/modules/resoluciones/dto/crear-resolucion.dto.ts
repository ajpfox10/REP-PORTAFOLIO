import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearResolucionDto {
    @ApiProperty({
        example: 'Resolución Nº 2024/1001',
        description: 'Texto de la resolución a registrar',
    })
    @IsString({ message: 'La resolución debe ser un texto' })
    @IsNotEmpty({ message: 'La resolución es obligatoria' })
    @MaxLength(500, { message: 'La resolución no puede exceder los 500 caracteres' })
    resolucion!: string;

    @ApiPropertyOptional({
        example: 'admin',
        description: 'Usuario que carga la resolución',
    })
    @IsString({ message: 'El usuario debe ser un texto' })
    @IsOptional()
    @MaxLength(50, { message: 'El usuario no puede exceder los 50 caracteres' })
    usuarioCarga?: string;
}
