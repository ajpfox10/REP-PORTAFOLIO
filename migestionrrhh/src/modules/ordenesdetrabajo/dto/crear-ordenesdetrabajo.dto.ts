// src/modules/ordenesdetrabajo/dto/crear-ordenesdetrabajo.dto.ts

import { IsString, IsNotEmpty, MaxLength, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearOrdenesdetrabajoDto {
    @ApiProperty({ example: 'Orden de reparaci�n de equipos', description: 'Nombre o t�tulo de la orden de trabajo' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
    nombre!: string;

    @ApiProperty({ example: 'Descripci�n detallada de la orden de trabajo' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'La descripci�n no puede exceder los 100 caracteres' })
    descripcion!: string;

    @ApiProperty({ example: 'admin', description: 'Usuario que realiza la carga' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'El usuario no puede exceder los 100 caracteres' })
    usuarioCarga!: string;

    @ApiPropertyOptional({ example: '2024-04-01', description: 'Fecha de alta (formato ISO)' })
    @IsOptional()
    @IsDateString()
    fechaDeAlta?: Date;
}
