// DTO para el módulo certificados
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearCertificadosDto {
    @ApiProperty({ example: 'Certificado de cumplimiento' })
    @IsString()
    @IsNotEmpty()
    descripcion!: string;

    @ApiProperty({ example: 'usuario@example.com' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
