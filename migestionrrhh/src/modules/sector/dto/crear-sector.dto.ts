import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearSectorDto {
    @ApiProperty({
        example: 'Departamento de Tecnología',
        description: 'Nombre del sector a registrar',
    })
    @IsString({ message: 'El nombre debe ser un texto' })
    @IsNotEmpty({ message: 'El nombre del sector es obligatorio' })
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
    nombre!: string;

    @ApiProperty({
        example: 'admin',
        description: 'Usuario que realiza la carga',
    })
    @IsString({ message: 'El usuario debe ser un texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder los 50 caracteres' })
    usuarioCarga!: string;
}
