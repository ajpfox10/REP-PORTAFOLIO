// src/modules/resoluciones/dto/crear-resolucion.dto.ts
import { IsString, IsOptional } from 'class-validator';

export class CrearResolucionDto {
    @IsString()
    resolucion!: string;

    @IsString()
    @IsOptional()
    usuarioCarga?: string;
}
