import {
    IsString,
    IsOptional,
    IsNotEmpty,
    MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearLocalidades1Dto {
    @ApiProperty({
        example: 'Ciudad Autónoma de Buenos Aires',
        description: 'Nombre de la localidad a registrar',
    })
    @IsString({ message: 'El nombre debe ser un texto' })
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
    nombre!: string;

    @ApiProperty({
        example: 'admin',
        description: 'Usuario que realiza la carga del registro',
    })
    @IsString({ message: 'El usuario debe ser un texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;

    @ApiPropertyOptional({
        example: 'Capital de Argentina',
        description: 'Descripción opcional de la localidad',
    })
    @IsOptional()
    @IsString({ message: 'La descripción debe ser un texto' })
    @MaxLength(255, { message: 'La descripción no puede exceder 255 caracteres' })
    descripcion?: string;
}

