import { IsString, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePersonalDto {
    @ApiProperty({ example: 'Juan', description: 'Nombre del personal' })
    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @ApiProperty({ example: 'Pérez', description: 'Apellido del personal' })
    @IsString()
    @IsNotEmpty()
    apellido!: string;

    @ApiProperty({ example: '12345678', description: 'DNI del personal' })
    @IsString()
    @IsNotEmpty()
    dni!: string;

    @ApiProperty({ example: 'Masculino', description: 'Sexo del personal' })
    @IsString()
    @IsNotEmpty()
    sexo!: string;

    @ApiProperty({ example: '2024-01-01', description: 'Fecha de nacimiento del personal' })
    @IsDateString()
    @IsOptional()
    fechaNacimiento?: Date;

    @ApiProperty({ example: 'Operario', description: 'Puesto o cargo del personal' })
    @IsString()
    @IsNotEmpty()
    cargo!: string;

    @ApiProperty({ example: 'usuario_admin', description: 'Usuario que carga el registro' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
