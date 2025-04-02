// DTO para el módulo cccoodegdeba
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearCccoodegdebaDto {
    @ApiProperty({ example: 'Descripción del registro cccoodegdeba' })
    @IsString()
    @IsNotEmpty()
    descripcion!: string;

    @ApiProperty({ example: 'usuario@example.com' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
