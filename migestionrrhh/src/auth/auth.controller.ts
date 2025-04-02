import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDto } from './dto/auth.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('login')
    @ApiOperation({ summary: 'Login de usuario y generación de JWT' })
    async login(@Body() authDto: AuthDto) {
        return this.authService.login(authDto);
    }

    // Ejemplo de endpoint protegido (opcional)
    @UseGuards(JwtAuthGuard)
    @Post('protegido')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Ruta protegida para probar el JWT' })
    getProtegido() {
        return { mensaje: 'Estás autenticado correctamente.' };
    }
}
