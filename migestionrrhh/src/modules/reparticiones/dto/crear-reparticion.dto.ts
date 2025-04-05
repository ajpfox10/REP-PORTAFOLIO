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
        description: 'C�digo identificador de la repartici�n',
    })
    @IsString({ message: 'El c�digo debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El c�digo es obligatorio' })
    @MaxLength(20, { message: 'El c�digo no puede exceder 20 caracteres' })
    codigo!: string;

    @ApiProperty({
        example: 'Repartici�n de servicios',
        description: 'Descripci�n detallada de la repartici�n',
    })
    @IsString({ message: 'La descripci�n debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'La descripci�n es obligatoria' })
    @MaxLength(255, { message: 'La descripci�n no puede exceder 255 caracteres' })
    descripcion!: string;

    @ApiProperty({
        example: 'RPS',
        description: 'Abreviatura de la repartici�n',
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
    @IsDateString({}, { message: 'La fecha debe tener formato ISO v�lido' })
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
