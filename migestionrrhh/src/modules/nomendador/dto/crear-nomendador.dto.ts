import { IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearNomendadorDto {
    @ApiProperty({ example: 'Dirección General de Administración', description: 'Nombre del nomendador' })
    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @ApiProperty({ example: '2024-04-01', description: 'Fecha de alta del registro (formato ISO)' })
    @IsDateString()
    @IsNotEmpty()
    fechaDeAlta!: Date;

    @ApiProperty({ example: 'admin', description: 'Usuario que da de alta el nomendador' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
