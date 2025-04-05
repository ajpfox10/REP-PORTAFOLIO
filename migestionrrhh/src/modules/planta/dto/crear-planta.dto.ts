import {
    IsString,
    IsNotEmpty,
    IsDateString,
    MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearPlantaDto {
    @ApiProperty({
        example: 'Planta Central',
        description: 'Nombre de la planta',
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre de la planta es obligatorio' })
    @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
    nombre!: string;

    @ApiProperty({
        example: '2024-04-01',
        description: 'Fecha de alta en formato ISO 8601',
    })
    @IsDateString({}, { message: 'La fecha debe estar en formato ISO' })
    @IsNotEmpty({ message: 'La fecha de alta es obligatoria' })
    fechaDeAlta!: Date;

    @ApiProperty({
        example: 'admin',
        description: 'Usuario que realiza la carga',
    })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
