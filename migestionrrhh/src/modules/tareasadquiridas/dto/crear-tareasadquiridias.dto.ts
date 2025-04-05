import {
    IsString,
    IsNumber,
    IsNotEmpty,
    IsOptional,
    IsDateString,
    MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearTareasadquiridiasDto {
    @ApiProperty({
        example: 'TAREA-001',
        description: 'Nombre del agente de trabajo que realizó la tarea',
    })
    @IsString({ message: 'El agente de trabajo debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El agente de trabajo es obligatorio' })
    @MaxLength(100, { message: 'El agente de trabajo no puede exceder 100 caracteres' })
    agenteDeTrabajo!: string;

    @ApiProperty({
        example: 1234,
        description: 'ID del agente relacionado',
    })
    @IsNumber({}, { message: 'El ID del agente debe ser un número' })
    @IsNotEmpty({ message: 'El ID del agente es obligatorio' })
    agente!: number;

    @ApiProperty({
        example: 5678,
        description: 'ID de la tarea adquirida',
    })
    @IsNumber({}, { message: 'El ID de la tarea debe ser un número' })
    @IsNotEmpty({ message: 'La tarea adquirida es obligatoria' })
    tareaAdquirida!: number;

    @ApiProperty({
        example: '2024-04-01',
        description: 'Fecha de adquisición (formato ISO)',
    })
    @IsDateString({}, { message: 'La fecha debe estar en formato ISO válido' })
    @IsNotEmpty({ message: 'La fecha de adquisición es obligatoria' })
    fechaDeAdquisicion!: Date;

    @ApiProperty({
        example: 'Memo de referencia',
        description: 'Referencia del memo relacionado a la tarea',
    })
    @IsString({ message: 'El memo debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El memo es obligatorio' })
    @MaxLength(200, { message: 'El memo no puede exceder 200 caracteres' })
    memo!: string;

    @ApiProperty({
        example: 1,
        description: 'Estado de la tarea (ej. 1 = activa, 0 = inactiva)',
    })
    @IsNumber({}, { message: 'El estado debe ser un número' })
    @IsNotEmpty({ message: 'El estado es obligatorio' })
    estado!: number;

    @ApiProperty({
        example: '2024-04-30',
        description: 'Fecha de finalización (formato ISO)',
    })
    @IsDateString({}, { message: 'La fecha debe estar en formato ISO válido' })
    @IsNotEmpty({ message: 'La fecha de finalización es obligatoria' })
    fechaDeFinalizacion!: Date;

    @ApiPropertyOptional({
        example: 'admin',
        description: 'Usuario que carga la tarea',
    })
    @IsOptional()
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga?: string;
}
