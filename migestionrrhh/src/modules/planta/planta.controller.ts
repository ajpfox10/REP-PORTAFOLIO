import {
    Controller,
    Get,
    Param,
    NotFoundException,
    UseGuards,
} from '@nestjs/common';
import { PlantaService } from './planta.service';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { RolesGuard } from '@auth/guards/roles.guard';
import { Roles } from '@auth/decoradores/roles.decorator';
import { Rol } from '@auth/interfaces/rol.enum';

@Controller('planta')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlantaController {
    constructor(private readonly plantaService: PlantaService) { }

    @Get(':id')
    @Roles(Rol.ADMIN, Rol.USER)
    async buscarPorId(@Param('id') id: number) {
        const planta = await this.plantaService.obtenerPorId(id);
        if (!planta) {
            throw new NotFoundException('Planta no encontrada');
        }
        return planta;
    }
}
