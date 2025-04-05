import {
    IsNotEmpty,
    IsString,
    IsNumber,
    IsOptional,
    MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearArchivoDto {
    @ApiProperty({
        example: 'informe_enero.pdf',
        description: 'Nombre del archivo con su extensión',
    })
    @IsString({ message: 'El nombre del archivo debe ser un texto' })
    @IsNotEmpty({ message: 'El nombre del archivo es obligatorio' })
    @MaxLength(255, { message: 'El nombre del archivo no puede exceder 255 caracteres' })
    nombreArchivo!: string;

    @ApiProperty({
        example: 'application/pdf',
        description: 'Tipo MIME del archivo (por ejemplo, application/pdf)',
    })
    @IsString({ message: 'El tipo de archivo debe ser un texto' })
    @IsNotEmpty({ message: 'El tipo de archivo es obligatorio' })
    @MaxLength(100, { message: 'El tipo de archivo no puede exceder 100 caracteres' })
    tipoArchivo!: string;

    @ApiProperty({
        example: 2024,
        description: 'Año de referencia del archivo',
    })
    @IsNumber({}, { message: 'El año debe ser un número' })
    @IsNotEmpty({ message: 'El año es obligatorio' })
    ano!: number;

    @ApiPropertyOptional({
        example: 'admin',
        description: 'Usuario que realiza la carga del archivo',
    })
    @IsOptional()
    @IsString({ message: 'El usuario de carga debe ser un texto' })
    @MaxLength(50, { message: 'El usuario de carga no puede exceder 50 caracteres' })
    usuarioCarga?: string;
}
