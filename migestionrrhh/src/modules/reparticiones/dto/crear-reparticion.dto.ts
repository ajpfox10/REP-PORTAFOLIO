import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsDateString,
    MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearReparticionesDto {
    @ApiProperty({
        example: 'REP-001',
        description: 'Código identificador de la repartición',
    })
    @IsString({ message: 'El código debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El código es obligatorio' })
    @MaxLength(20, { message: 'El código no puede exceder 20 caracteres' })
    codigo!: string;

    @ApiProperty({
        example: 'Repartición de servicios',
        description: 'Descripción detallada de la repartición',
    })
    @IsString({ message: 'La descripción debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'La descripción es obligatoria' })
    @MaxLength(255, { message: 'La descripción no puede exceder 255 caracteres' })
    descripcion!: string;

    @ApiProperty({
        example: 'RPS',
        description: 'Abreviatura de la repartición',
    })
    @IsString({ message: 'La abreviatura debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'La abreviatura es obligatoria' })
    @MaxLength(10, { message: 'La abreviatura no puede exceder 10 caracteres' })
    abreviatura!: string;

    @ApiPropertyOptional({
        example: '2024-04-01',
        description: 'Fecha de alta en formato ISO',
    })
    @IsOptional()
    @IsDateString({}, { message: 'La fecha debe tener formato ISO válido' })
    fechaDeAlta?: Date;

    @ApiPropertyOptional({
        example: 'admin@example.com',
        description: 'Usuario que registra el registro',
    })
    @IsOptional()
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga?: string;
}
