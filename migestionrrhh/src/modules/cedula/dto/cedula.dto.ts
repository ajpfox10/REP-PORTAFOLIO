import {
    IsString,
    IsNotEmpty,
    IsDateString,
    IsOptional,
    MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearCedulaDto {
    @ApiProperty({ example: 'CED-00123', description: 'Número único de la cédula' })
    @IsString({ message: 'El número debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El número de cédula es obligatorio' })
    @MaxLength(20, { message: 'El número no puede exceder 20 caracteres' })
    numero!: string;

    @ApiProperty({ example: '2024-03-31', description: 'Fecha de emisión de la cédula (formato ISO 8601)' })
    @IsDateString({}, { message: 'La fecha debe estar en formato ISO 8601' })
    @IsNotEmpty({ message: 'La fecha de emisión es obligatoria' })
    fechaEmision!: Date;

    @ApiProperty({ example: 'Juan Pérez', description: 'Nombre del titular de la cédula' })
    @IsString({ message: 'El titular debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre del titular es obligatorio' })
    @MaxLength(100, { message: 'El nombre del titular no puede exceder 100 caracteres' })
    titular!: string;

    @ApiProperty({ example: 'Domicilio del titular', description: 'Domicilio del titular (opcional)' })
    @IsString({ message: 'El domicilio debe ser una cadena de texto' })
    @IsOptional()
    @MaxLength(200, { message: 'El domicilio no puede exceder 200 caracteres' })
    domicilio?: string;

    @ApiProperty({ example: 'adminuser', description: 'Usuario que crea la cédula' })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario que carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
