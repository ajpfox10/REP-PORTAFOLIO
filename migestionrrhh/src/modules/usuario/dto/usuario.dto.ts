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
} from 'class-validator';

export class CreateUsuarioDto {
    @IsString()
    @IsNotEmpty({ message: 'El nombre de usuario es obligatorio' })
    @MaxLength(50, { message: 'El nombre de usuario no puede exceder 50 caracteres' })
    nombreUsuario!: string;

    @IsEmail({}, { message: 'Debe ser un email válido' })
    @IsNotEmpty({ message: 'El email es obligatorio' })
    @MaxLength(100, { message: 'El email no puede exceder 100 caracteres' })
    email!: string;

    @IsString()
    @IsNotEmpty({ message: 'El servicio es obligatorio' })
    @MaxLength(50, { message: 'El servicio no puede exceder 50 caracteres' })
    servicio!: string;

    @IsString()
    @IsNotEmpty({ message: 'El sector es obligatorio' })
    @MaxLength(50, { message: 'El sector no puede exceder 50 caracteres' })
    sector!: string;

    @IsString()
    @IsNotEmpty({ message: 'El rol es obligatorio' })
    @MaxLength(50, { message: 'El rol no puede exceder 50 caracteres' })
    rol!: string;

    @IsInt({ message: 'El nivel debe ser un número entero' })
    @IsNotEmpty({ message: 'El nivel es obligatorio' })
    lvl!: number;

    @IsString()
    @IsNotEmpty({ message: 'La contraseña es obligatoria' })
    @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
    @MaxLength(100, { message: 'La contraseña no puede exceder 100 caracteres' })
    password!: string;

    @IsPhoneNumber(undefined, { message: 'Debe ser un número de teléfono válido' })
    @IsOptional()
    telefono?: string;

    @IsDateString({}, { message: 'La fecha de creación debe ser una fecha válida' })
    @IsOptional()
    createdAt?: Date;

    @IsDateString({}, { message: 'La fecha de actualización debe ser una fecha válida' })
    @IsOptional()
    updatedAt?: Date;
}

export class UpdateUsuarioDto {
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
    lvl?: number;

    @IsOptional()
    @IsString()
    @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
    @MaxLength(100, { message: 'La contraseña no puede exceder 100 caracteres' })
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