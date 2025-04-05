import {
    IsString,
    IsNotEmpty,
    IsDateString,
    MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearRangoshorariosDto {
    @ApiProperty({
        example: 'Turno Mañana',
        description: 'Nombre del rango horario',
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
    nombre!: string;

    @ApiProperty({
        example: '2024-04-01',
        description: 'Fecha de alta en formato ISO',
    })
    @IsDateString({}, { message: 'La fecha debe tener formato ISO válido' })
    @IsNotEmpty({ message: 'La fecha de alta es obligatoria' })
    fechaDeAlta!: Date;

    @ApiProperty({
        example: 'admin',
        description: 'Usuario que realiza la carga',
    })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder los 50 caracteres' })
    usuarioCarga!: string;
}
