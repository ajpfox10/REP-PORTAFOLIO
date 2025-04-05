import { IsInt, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EliminarTareasDto {
    @ApiProperty({ example: 1, description: 'ID del recurso a eliminar' })
    @IsInt()
    @IsNotEmpty()
    id!: number;
}
