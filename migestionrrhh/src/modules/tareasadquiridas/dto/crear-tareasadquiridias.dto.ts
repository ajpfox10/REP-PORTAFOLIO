import { IsString, IsNumber, IsDate, IsOptional } from 'class-validator';

export class CrearTareasadquiridiasDto {
    @IsString()
    AGENTEDETRABAJO!: string;

    @IsNumber()
    AGENTE!: number;

    @IsNumber()
    TAREAADQUIRIDA!: number;

    @IsDate()
    FECHADEADQUISICION!: Date;

    @IsString()
    MEMO!: string;

    @IsNumber()
    ESTADO!: number;

    @IsDate()
    FECHADEFINALIZACION!: Date;

    @IsOptional()
    @IsString()
    usuarioCarga?: string;
}
