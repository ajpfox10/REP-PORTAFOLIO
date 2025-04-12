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
    @IsEmail({}, { message: 'Debe ser un email válido' })
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
    @IsInt({ message: 'El nivel debe ser un número entero' })
    @Min(1, { message: 'El nivel debe ser al menos 1' })
    lvl?: number;

    @IsOptional()
    @IsString()
    @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
    @MaxLength(100, { message: 'La contraseña no puede exceder 100 caracteres' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
        message: 'La contraseña debe incluir mayúsculas, minúsculas y números',
    })
    password?: string;

    @IsOptional()
    @IsPhoneNumber(undefined, { message: 'Debe ser un número de teléfono válido' })
    telefono?: string;

    @IsOptional()
    @IsDateString({}, { message: 'La fecha de creación debe ser una fecha válida' })
    createdAt?: Date;

    @IsOptional()
    @IsDateString({}, { message: 'La fecha de actualización debe ser una fecha válida' })
    updatedAt?: Date;
}

export class CreateUsuarioDto extends BaseUsuarioDto {
    @IsString()
    @IsNotEmpty({ message: 'El nombre de usuario es obligatorio' })
    override nombreUsuario!: string;

    @IsEmail({}, { message: 'Debe ser un email válido' })
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

    @IsInt({ message: 'El nivel debe ser un número entero' })
    @Min(1, { message: 'El nivel debe ser al menos 1' })
    @IsNotEmpty({ message: 'El nivel es obligatorio' })
    override lvl!: number;

    @IsString()
    @IsNotEmpty({ message: 'La contraseña es obligatoria' })
    override password!: string;
}

export class UpdateUsuarioDto extends BaseUsuarioDto { }
