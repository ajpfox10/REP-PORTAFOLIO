// DTO para el módulo cargosdeinicio
import { IsString, IsNotEmpty, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearCargosDeInicioDto {
    @ApiProperty({ example: 'Gerente de Ventas' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'El nombre del cargo no puede exceder 100 caracteres' })

    cargo!: string;

    @ApiProperty({ example: 'Responsable de dirigir el área de ventas y estrategias comerciales' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'El nombre del cargo no puede exceder 100 caracteres' })

    descripcion!: string;

    @ApiProperty({ example: '2024-04-01', description: 'Fecha de alta en formato ISO' })
    @IsDateString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'El nombre del cargo no puede exceder 100 caracteres' })

    fechaDeAlta!: Date;

    @ApiProperty({ example: 'admin@example.com' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100, { message: 'El nombre del cargo no puede exceder 100 caracteres' })

    usuarioCarga!: string;
}
