import { IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearPedidosDto {
    @ApiProperty({ example: 'Pedido de insumos de oficina', description: 'Nombre o descripción del pedido' })
    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @ApiProperty({ example: '2024-04-01', description: 'Fecha en que se da de alta el pedido (formato ISO)' })
    @IsDateString()
    @IsNotEmpty()
    fechaDeAlta!: Date;

    @ApiProperty({ example: 'admin', description: 'Usuario que carga el pedido en el sistema' })
    @IsString()
    @IsNotEmpty()
    usuarioCarga!: string;
}
