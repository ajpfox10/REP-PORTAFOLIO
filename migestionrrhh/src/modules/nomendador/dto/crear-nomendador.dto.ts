import { IsString, IsNotEmpty, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearNomendadorDto {
    @ApiProperty({ example: 'Dirección General de Administración', description: 'Nombre del nomendador' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
    nombre!: string;

    @ApiProperty({ example: '2024-04-01', description: 'Fecha de alta del registro (formato ISO)' })
    @IsDateString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })

    fechaDeAlta!: Date;

    @ApiProperty({ example: 'admin', description: 'Usuario que da de alta el nomendador' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
    usuarioCarga!: string;
}
