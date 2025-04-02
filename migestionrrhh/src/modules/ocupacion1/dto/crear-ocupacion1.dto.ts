import { IsString } from 'class-validator';

export class CrearOcupacion1Dto {
    @IsString()
    nombre!: string;

    @IsString()
    usuarioCarga!: string;
}
