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
        description: 'Correo electrónico del usuario',
    })
    @IsEmail({}, { message: 'El correo debe ser válido' })
    @IsNotEmpty({ message: 'El correo es obligatorio' })
    @MaxLength(100, { message: 'El correo no debe superar los 100 caracteres' })
    email!: string;

    @ApiProperty({
        example: 'Contrasena123!',
        description: 'Contraseña del usuario (mínimo 6 caracteres)',
    })
    @IsNotEmpty({ message: 'La contraseña es obligatoria' })
    @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
    @MaxLength(100, { message: 'La contraseña no debe superar los 100 caracteres' })
    @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
        message: 'La contraseña debe contener letras y números',
    })
    password!: string;
}
