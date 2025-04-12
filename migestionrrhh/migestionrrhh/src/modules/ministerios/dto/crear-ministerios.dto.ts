import {
    IsNotEmpty,
    IsString,
    IsDateString,
    MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearMinisteriosDto {
    @ApiProperty({ example: 'Ministerio de Salud', description: 'Nombre del ministerio' })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre del ministerio es obligatorio' })
    @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
    nombre!: string;

    @ApiProperty({ example: '2024-03-31', description: 'Fecha de alta del registro (ISO 8601)' })
    @IsDateString({}, { message: 'La fecha debe estar en formato ISO 8601' })
    @IsNotEmpty({ message: 'La fecha de alta es obligatoria' })
    fechaDeAlta!: Date;

    @ApiProperty({ example: 'admin', description: 'Usuario que realizó el alta' })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario que realiza la carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
