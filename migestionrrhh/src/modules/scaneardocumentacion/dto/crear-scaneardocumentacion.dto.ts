import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearScaneardocumentacionDto {
    @ApiProperty({
        example: 'Documento escaneado de identidad',
        description: 'Descripci�n del archivo escaneado',
    })
    @IsString({ message: 'La descripci�n debe ser un texto' })
    @IsNotEmpty({ message: 'La descripci�n es obligatoria' })
    @MaxLength(255, { message: 'La descripci�n no puede exceder 255 caracteres' })
    descripcion!: string;

    @ApiProperty({
        example: '/uploads/documentos/scan_123.pdf',
        description: 'Ruta donde se encuentra almacenado el archivo escaneado',
    })
    @IsString({ message: 'El path debe ser un texto' })
    @IsNotEmpty({ message: 'El path es obligatorio' })
    @MaxLength(255, { message: 'El path no puede exceder 255 caracteres' })
    path!: string;

    @ApiPropertyOptional({
        example: 'admin',
        description: 'Usuario que realiz� la carga',
    })
    @IsString({ message: 'El usuario debe ser un texto' })
    @IsOptional()
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga?: string;
}
