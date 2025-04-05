import {
    IsOptional,
    IsString,
    IsDateString,
    MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMinisteriosDto {
    @ApiPropertyOptional({ example: 'Ministerio de Educación', description: 'Nuevo nombre del ministerio' })
    @IsOptional()
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
    nombre?: string;

    @ApiPropertyOptional({ example: '2024-04-01', description: 'Fecha de modificación (ISO 8601)' })
    @IsOptional()
    @IsDateString({}, { message: 'La fecha debe estar en formato ISO 8601' })
    fechaDeAlta?: Date;

    @ApiPropertyOptional({ example: 'admin2', description: 'Usuario que realiza la modificación' })
    @IsOptional()
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga?: string;
}
