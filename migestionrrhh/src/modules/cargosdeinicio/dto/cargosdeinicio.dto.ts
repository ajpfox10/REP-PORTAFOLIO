// DTO para el módulo cargosdeinicio
import { IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearCargosDeInicioDto {
    @ApiProperty({ example: 'Gerente de Ventas' })
    @IsString()
    @IsNotEmpty()
    cargo!: string;

    @ApiProperty({ example: 'Responsable de dirigir el área de ventas y estrategias comerciales' })
    @IsString()
    @IsNotEmpty()
    descripcion!: string;

    @ApiProperty({ example: '2024-04-01', description: 'Fecha de alta en formato ISO' })
    @IsDateString()
    @IsNotEmpty()
    fechaDeAlta!: Date;

    @ApiProperty({ example: 'admin@example.com' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
