// src/modules/archivos/dto/crear-archivo.dto.ts

import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearArchivoDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    nombreArchivo!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    tipoArchivo!: string;

    @ApiProperty()
    @IsNumber()
    @IsNotEmpty()
    ano!: number; // ✅ corregido el nombre del campo

    @ApiProperty()
    @IsOptional()
    @IsString()
    usuarioCarga?: string;
}
