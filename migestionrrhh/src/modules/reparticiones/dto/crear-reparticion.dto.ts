import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearReparticionesDto {
    @ApiProperty({ example: 'REP-001', description: 'C�digo identificador de la repartici�n' })
    @IsString()
    @IsNotEmpty()
    codigo!: string;

    @ApiProperty({ example: 'Repartici�n de servicios', description: 'Descripci�n detallada de la repartici�n' })
    @IsString()
    @IsNotEmpty()
    descripcion!: string;

    @ApiProperty({ example: 'RPS', description: 'Abreviatura de la repartici�n' })
    @IsString()
    @IsNotEmpty()
    abreviatura!: string;

    @ApiProperty({ example: '2024-04-01', description: 'Fecha de alta en formato ISO', required: false })
    @IsOptional()
    @IsDateString()
    fechaDeAlta?: Date;

    @ApiProperty({ example: 'admin@example.com', description: 'Usuario que registra el registro', required: false })
    @IsOptional()
    @IsString()
    usuarioCarga?: string;
}
