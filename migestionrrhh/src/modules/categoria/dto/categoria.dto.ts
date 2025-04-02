// DTO para el módulo categoria
import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearCategoriaDto {
    @ApiProperty({ example: 'Electrónica' })
    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @ApiProperty({ example: 'Categoría de productos electrónicos', required: false })
    @IsString()
    @IsOptional()
    descripcion?: string;

    @ApiProperty({ example: '2024-04-01', required: false, description: 'Fecha de alta en formato ISO' })
    @IsDateString()
    @IsOptional()
    fechaDeAlta?: Date;

    @ApiProperty({ example: 'admin@example.com', required: false })
    @IsString()
    @IsOptional()
    usuarioCarga?: string;
}
