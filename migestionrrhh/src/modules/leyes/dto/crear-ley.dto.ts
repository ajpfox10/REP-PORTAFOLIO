// src/modules/leyes/dto/crear-ley.dto.ts
import { IsString, IsNumber } from 'class-validator';

export class CrearLeyDto {
	@IsString()
	Ley!: string;

	@IsNumber()
	codigoleyes!: number;

	@IsNumber()
	leyactiva!: number;

	@IsString()
	usuarioCarga!: string;
}
