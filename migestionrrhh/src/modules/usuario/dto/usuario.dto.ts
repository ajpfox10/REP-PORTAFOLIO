import {
    IsString,
    IsEmail,
    IsNotEmpty,
    MinLength,
    MaxLength,
    IsInt,
    IsOptional,
    Matches,
    IsPhoneNumber,
    IsDateString,
    Min,
} from 'class-validator';

// Clase base compartida entre Create y Update
class BaseUsuarioDto {
    @IsOptional()
    @IsString()
    @MaxLength(50, { message: 'El nombre de usuario no puede exceder 50 caracteres' })
    nombreUsuario?: string;

    @IsOptional()
    @IsEmail({}, { message: 'Debe ser un email v�lido' })
    @MaxLength(100, { message: 'El email no puede exceder 100 caracteres' })
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50, { message: 'El servicio no puede exceder 50 caracteres' })
    servicio?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50, { message: 'El sector no puede exceder 50 caracteres' })
    sector?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50, { message: 'El rol no puede exceder 50 caracteres' })
    rol?: string;

    @IsOptional()
    @IsInt({ message: 'El nivel debe ser un n�mero entero' })
    @Min(1, { message: 'El nivel debe ser al menos 1' })
    lvl?: number;

    @IsOptional()
    @IsString()
    @MinLength(6, { message: 'La contrase�a debe tener al menos 6 caracteres' })
    @MaxLength(100, { message: 'La contrase�a no puede exceder 100 caracteres' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
        message: 'La contrase�a debe incluir may�sculas, min�sculas y n�meros',
    })
    password?: string;

    @IsOptional()
    @IsPhoneNumber(undefined, { message: 'Debe ser un n�mero de tel�fono v�lido' })
    telefono?: string;

    @IsOptional()
    @IsDateString({}, { message: 'La fecha de creaci�n debe ser una fecha v�lida' })
    createdAt?: Date;

    @IsOptional()
    @IsDateString({}, { message: 'La fecha de actualizaci�n debe ser una fecha v�lida' })
    updatedAt?: Date;
}

export class CreateUsuarioDto extends BaseUsuarioDto {
    @IsString()
    @IsNotEmpty({ message: 'El nombre de usuario es obligatorio' })
    override nombreUsuario!: string;

    @IsEmail({}, { message: 'Debe ser un email v�lido' })
    @IsNotEmpty({ message: 'El email es obligatorio' })
    override email!: string;

    @IsString()
    @IsNotEmpty({ message: 'El servicio es obligatorio' })
    override servicio!: string;

    @IsString()
    @IsNotEmpty({ message: 'El sector es obligatorio' })
    override sector!: string;

    @IsString()
    @IsNotEmpty({ message: 'El rol es obligatorio' })
    override rol!: string;

    @IsInt({ message: 'El nivel debe ser un n�mero entero' })
    @Min(1, { message: 'El nivel debe ser al menos 1' })
    @IsNotEmpty({ message: 'El nivel es obligatorio' })
    override lvl!: number;

    @IsString()
    @IsNotEmpty({ message: 'La contrase�a es obligatoria' })
    override password!: string;
}

export class UpdateUsuarioDto extends BaseUsuarioDto { }
