import { IsString, IsNotEmpty, IsOptional, MaxLength, IsDate } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearResolucionDto {
    @ApiProperty({
        example: 'Resoluci�n N� 2024/1001',
        description: 'Texto de la resoluci�n a registrar',
    })
    @IsString({ message: 'La resoluci�n debe ser un texto' })
    @IsNotEmpty({ message: 'La resoluci�n es obligatoria' })
    @MaxLength(500, { message: 'La resoluci�n no puede exceder los 500 caracteres' })
    resolucion!: string;

    @ApiPropertyOptional({
        example: 'admin',
        description: 'Usuario que carga la resoluci�n',
    })
    @IsString({ message: 'El usuario debe ser un texto' })
    @IsOptional()
    @MaxLength(50, { message: 'El usuario no puede exceder los 50 caracteres' })
    usuarioCarga!: string;

    @ApiPropertyOptional({
        example: '2024-04-11T10:00:00.000Z',
        description: 'Fecha de carga autom�tica',
    })
    @IsOptional()
    @IsDate({ message: 'fechaDeAlta debe ser una fecha v�lida' })
    fechaDeAlta?: Date;
}
