import {
    IsOptional,
    IsString,
    MaxLength,
    IsDateString,
    IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearTareasDto {
    @ApiPropertyOptional({ example: 'Finalizó correctamente', description: 'Comentarios del agente que realizó la tarea' })
    @IsOptional()
    @IsString({ message: 'Los comentarios deben ser una cadena de texto' })
    @MaxLength(255, { message: 'Los comentarios no pueden exceder 255 caracteres' })
    comentariosagenterealizo?: string;

    @ApiPropertyOptional({ example: 'Revisión de expediente', description: 'Descripción de la tarea' })
    @IsOptional()
    @IsString({ message: 'La tarea debe ser una cadena de texto' })
    @MaxLength(100, { message: 'La tarea no puede exceder 100 caracteres' })
    tarea?: string;

    @ApiPropertyOptional({ example: '2024-04-01', description: 'Fecha de baja de la tarea (ISO 8601)' })
    @IsOptional()
    @IsDateString({}, { message: 'La fecha de baja debe tener formato ISO' })
    fechadebajadetarea?: Date;

    @ApiPropertyOptional({ example: '2024-03-15', description: 'Fecha de alta de la tarea (ISO 8601)' })
    @IsOptional()
    @IsDateString({}, { message: 'La fecha de alta debe tener formato ISO' })
    fechadealtadetarea?: Date;

    @ApiPropertyOptional({ example: 'jdoe', description: 'Usuario al que se asignó la tarea' })
    @IsOptional()
    @IsString({ message: 'El usuario asignado debe ser una cadena de texto' })
    @MaxLength(50, { message: 'El usuario asignado no puede exceder 50 caracteres' })
    asifgnadoa?: string;

    @ApiProperty({ example: 'admin', description: 'Usuario que carga la tarea' })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
