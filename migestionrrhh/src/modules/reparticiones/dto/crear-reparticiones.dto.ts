import { IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearReparticionesDto {
    @ApiProperty({ example: 'Dirección de Recursos Humanos', description: 'Nombre de la repartición' })
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
