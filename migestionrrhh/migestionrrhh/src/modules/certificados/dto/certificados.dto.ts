import { IsString, IsNotEmpty, IsDateString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearCertificadosDto {
    @ApiProperty({ example: 'Certificado ISO 9001' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    nombre!: string;

    @ApiProperty({ example: 'Certificado de calidad', required: false })
    @IsString()
    @IsOptional()
    descripcion?: string;

    @ApiProperty({ example: 'admin' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;

    @ApiPropertyOptional({ example: '2024-04-01', description: 'Fecha en formato ISO' })
    @IsOptional()
    @IsDateString()
    fechaDeAlta?: Date;
}
