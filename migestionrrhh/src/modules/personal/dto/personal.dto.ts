import {
    IsString,
    IsNotEmpty,
    MaxLength,
    IsOptional,
    IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePersonalDto {
    @ApiProperty({ example: 'Juan', description: 'Nombre del personal' })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    @MaxLength(50, { message: 'El nombre no puede exceder 50 caracteres' })
    nombre!: string;

    @ApiProperty({ example: 'Pérez', description: 'Apellido del personal' })
    @IsString({ message: 'El apellido debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El apellido es obligatorio' })
    @MaxLength(50, { message: 'El apellido no puede exceder 50 caracteres' })
    apellido!: string;

    @ApiProperty({ example: '12345678', description: 'DNI del personal' })
    @IsString({ message: 'El DNI debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El DNI es obligatorio' })
    @MaxLength(15, { message: 'El DNI no puede exceder 15 caracteres' })
    dni!: string;

    @ApiProperty({ example: 'Masculino', description: 'Sexo del personal' })
    @IsString({ message: 'El sexo debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El sexo es obligatorio' })
    @MaxLength(20, { message: 'El sexo no puede exceder 20 caracteres' })
    sexo!: string;

    @ApiPropertyOptional({ example: '2024-01-01', description: 'Fecha de nacimiento del personal' })
    @IsDateString({}, { message: 'La fecha debe estar en formato ISO' })
    @IsOptional()
    fechaNacimiento?: Date;

    @ApiProperty({ example: 'Operario', description: 'Puesto o cargo del personal' })
    @IsString({ message: 'El cargo debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El cargo es obligatorio' })
    @MaxLength(100, { message: 'El cargo no puede exceder 100 caracteres' })
    cargo!: string;

    @ApiProperty({ example: 'usuario_admin', description: 'Usuario que carga el registro' })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
