// DTO para el módulo cedula
import { IsString, IsNotEmpty, IsDateString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearCedulaDto {
    @ApiProperty({ example: 'CED-00123' })
    @IsString()
    @IsNotEmpty()
    numero!: string;

    @ApiProperty({ example: '2024-03-31' })
    @IsDateString()
    @IsNotEmpty()
    fechaEmision!: Date;

    @ApiProperty({ example: 'Juan Pérez' })
    @IsString()
    @IsNotEmpty()
    titular!: string;

    @ApiProperty({ example: 'Domicilio del titular' })
    @IsString()
    @IsOptional()
    domicilio?: string;

    @ApiProperty({ example: 'adminuser' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
