import { IsString, IsOptional } from 'class-validator';

export class CrearScaneardocumentacionDto {
    @IsString()
    descripcion!: string;

    @IsString()
    path!: string;

    @IsString()
    @IsOptional()
    usuarioCarga?: string;
}
