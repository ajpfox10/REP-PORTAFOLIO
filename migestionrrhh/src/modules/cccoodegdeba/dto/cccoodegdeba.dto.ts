import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearCccoodegdebaDto {
    @ApiProperty({
        example: 'Descripción del registro cccoodegdeba',
        description: 'Detalle o nombre del registro',
    })
    @IsString({ message: 'La descripción debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'La descripción es obligatoria' })
    @MaxLength(200, { message: 'La descripción no puede exceder 200 caracteres' })
    descripcion!: string;

    @ApiProperty({
        example: 'usuario@example.com',
        description: 'Usuario que realiza la carga',
    })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
