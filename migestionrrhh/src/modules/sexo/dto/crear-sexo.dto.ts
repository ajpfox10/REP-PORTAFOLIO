import { IsString, IsOptional } from 'class-validator';

export class CrearSexoDto {
    @IsString()
    nombre!: string;

    @IsString()
    @IsOptional()
    usuarioCarga?: string;
}
