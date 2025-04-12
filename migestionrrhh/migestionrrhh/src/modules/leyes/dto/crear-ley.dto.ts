import { IsString, IsNumber, IsNotEmpty, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CrearLeyDto {
    @ApiProperty({ example: 'Ley de Protecci�n de Datos', description: 'Nombre de la ley' })
    @IsString({ message: 'El nombre de la ley debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre de la ley es obligatorio' })
    @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
    Ley!: string;

    @ApiProperty({ example: 1001, description: 'C�digo interno de la ley' })
    @Type(() => Number)
    @IsNumber({}, { message: 'El c�digo de ley debe ser un n�mero' })
    codigoleyes!: number;

    @ApiProperty({ example: 1, description: 'Indica si la ley est� activa (1) o no (0)' })
    @Type(() => Number)
    @IsNumber({}, { message: 'El campo leyactiva debe ser un n�mero' })
    leyactiva!: number;

    @ApiProperty({ example: 'admin', description: 'Usuario que registr� la ley' })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario que realiza la carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
