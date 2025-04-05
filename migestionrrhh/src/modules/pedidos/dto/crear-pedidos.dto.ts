import {
    IsString,
    IsNotEmpty,
    IsDateString,
    MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearPedidosDto {
    @ApiProperty({
        example: 'Pedido de insumos de oficina',
        description: 'Nombre o descripción del pedido',
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre del pedido es obligatorio' })
    @MaxLength(150, { message: 'El nombre no puede exceder 150 caracteres' })
    nombre!: string;

    @ApiProperty({
        example: '2024-04-01',
        description: 'Fecha en que se da de alta el pedido (formato ISO)',
    })
    @IsDateString({}, { message: 'La fecha debe estar en formato ISO 8601' })
    @IsNotEmpty({ message: 'La fecha de alta es obligatoria' })
    fechaDeAlta!: Date;

    @ApiProperty({
        example: 'admin',
        description: 'Usuario que carga el pedido en el sistema',
    })
    @IsString({ message: 'El usuario debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El usuario de carga es obligatorio' })
    @MaxLength(50, { message: 'El usuario no puede exceder 50 caracteres' })
    usuarioCarga!: string;
}
