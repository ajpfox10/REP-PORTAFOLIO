import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AuthDto {
    @ApiProperty({ example: 'correo@ejemplo.com' })
    @IsEmail({}, { message: 'El correo debe ser v�lido' })
    email!: string;

    @ApiProperty({ example: 'contrasena123' })
    @IsNotEmpty({ message: 'La contrase�a es obligatoria' })
    @MinLength(6, { message: 'La contrase�a debe tener al menos 6 caracteres' })
    password!: string;
}