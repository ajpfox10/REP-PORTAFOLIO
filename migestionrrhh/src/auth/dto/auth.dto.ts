import {
    IsEmail,
    IsNotEmpty,
    MinLength,
    MaxLength,
    Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AuthDto {
    @ApiProperty({
        example: 'correo@ejemplo.com',
        description: 'Correo electr�nico del usuario',
    })
    @IsEmail({}, { message: 'El correo debe ser v�lido' })
    @IsNotEmpty({ message: 'El correo es obligatorio' })
    @MaxLength(100, { message: 'El correo no debe superar los 100 caracteres' })
    email!: string;

    @ApiProperty({
        example: 'Contrasena123!',
        description: 'Contrase�a del usuario (m�nimo 6 caracteres)',
    })
    @IsNotEmpty({ message: 'La contrase�a es obligatoria' })
    @MinLength(6, { message: 'La contrase�a debe tener al menos 6 caracteres' })
    @MaxLength(100, { message: 'La contrase�a no debe superar los 100 caracteres' })
    @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
        message: 'La contrase�a debe contener letras y n�meros',
    })
    password!: string;
}
