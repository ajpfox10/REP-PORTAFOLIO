import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearOcupacion1Dto {
    @ApiProperty({
        example: 'Ingeniero en Sistemas',
        description: 'Nombre de la ocupación',
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
    nombre!: string;

    @ApiProperty({
        example: 'admin',
        description: 'Usuario que realiza la carga',
    })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
