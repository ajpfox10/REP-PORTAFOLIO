import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsDateString,
    MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearTipoTramiteDto {
    @ApiProperty({
        example: 'Autorizaci�n de viaje',
        description: 'Tipo de tr�mite que se va a registrar',
    })
    @IsString({ message: 'El tipo de tr�mite debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El tipo de tr�mite es obligatorio' })
    @MaxLength(100, { message: 'El tipo de tr�mite no puede exceder 100 caracteres' })
    TIPODETRAMITE!: string;

    @ApiPropertyOptional({
        example: '2024-04-01',
        description: 'Fecha de alta del tr�mite (formato ISO)',
    })
    @IsOptional()
    @IsDateString({}, { message: 'La fecha debe tener formato ISO v�lido' })
    fechaDeAlta?: Date;

    @ApiProperty({
        example: 'admin',
        description: 'Usuario que realiza la carga del tr�mite',
    })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
