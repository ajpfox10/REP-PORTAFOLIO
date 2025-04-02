// src/modules/ministerios/dto/crear-ministerios.dto.ts

import { IsNotEmpty, IsString, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearMinisteriosDto {
    @ApiProperty({ example: 'Ministerio de Salud', description: 'Nombre del ministerio' })
    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @ApiProperty({ example: '2024-03-31', description: 'Fecha de alta del registro (ISO 8601)' })
    @IsDateString()
    @IsNotEmpty()
    fechaDeAlta!: Date;

    @ApiProperty({ example: 'admin', description: 'Usuario que realizó el alta' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
