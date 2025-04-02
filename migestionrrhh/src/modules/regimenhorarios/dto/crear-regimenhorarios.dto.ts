import { IsString, IsOptional } from 'class-validator';

export class CrearRegimenhorariosDto {
    @IsString()
    nombre!: string;

    @IsString()
    @IsOptional()
    usuarioCarga?: string;
}
