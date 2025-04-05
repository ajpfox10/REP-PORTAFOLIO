import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearResolucionDto {
    @ApiProperty({
        example: 'Resoluci�n N� 2024/1001',
        description: 'Texto de la resoluci�n a registrar',
    })
    @IsString({ message: 'La resoluci�n debe ser un texto' })
    @IsNotEmpty({ message: 'La resoluci�n es obligatoria' })
    @MaxLength(500, { message: 'La resoluci�n no puede exceder los 500 caracteres' })
    resolucion!: string;

    @ApiPropertyOptional({
        example: 'admin',
        description: 'Usuario que carga la resoluci�n',
    })
    @IsString({ message: 'El usuario debe ser un texto' })
    @IsOptional()
    @MaxLength(50, { message: 'El usuario no puede exceder los 50 caracteres' })
    usuarioCarga?: string;
}
