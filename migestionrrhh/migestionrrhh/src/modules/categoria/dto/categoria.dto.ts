import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsDateString,
    MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearCategoriaDto {
    @ApiProperty({
        example: 'Electrónica',
        description: 'Nombre de la categoría',
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre de la categoría es obligatorio' })
    @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
    nombre!: string;

    @ApiPropertyOptional({
        example: 'Categoría de productos electrónicos',
        description: 'Descripción breve (opcional)',
    })
    @IsString({ message: 'La descripción debe ser una cadena de texto' })
    @IsOptional()
    @MaxLength(255, { message: 'La descripción no puede exceder 255 caracteres' })
    descripcion?: string;

    @ApiPropertyOptional({
        example: '2024-04-01',
        description: 'Fecha de alta en formato ISO 8601',
    })
    @IsDateString({}, { message: 'La fecha debe estar en formato ISO' })
    @IsOptional()
    fechaDeAlta?: Date;

    @ApiPropertyOptional({
        example: 'admin@example.com',
        description: 'Usuario que realiza la carga',
    })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsOptional()
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga?: string;
}
