import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearSexoDto {
    @ApiProperty({
        example: 'Masculino',
        description: 'Nombre del sexo',
    })
    @IsString({ message: 'El nombre debe ser un texto' })
    @IsNotEmpty({ message: 'El nombre del sexo es obligatorio' })
    @MaxLength(50, { message: 'El nombre no puede exceder 50 caracteres' })
    nombre!: string;

    @ApiPropertyOptional({
        example: 'admin',
        description: 'Usuario que realiza la carga',
    })
    @IsString({ message: 'El usuario debe ser un texto' })
    @IsOptional()
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga?: string;
}
