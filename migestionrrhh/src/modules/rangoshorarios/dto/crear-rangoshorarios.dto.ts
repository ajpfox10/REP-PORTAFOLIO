import { IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearRangoshorariosDto {
    @ApiProperty({ example: 'Turno Mañana', description: 'Nombre del rango horario' })
    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @ApiProperty({ example: '2024-04-01', description: 'Fecha de alta en formato ISO' })
    @IsDateString()
    @IsNotEmpty()
    fechaDeAlta!: Date;

    @ApiProperty({ example: 'admin', description: 'Usuario que realiza la carga' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
