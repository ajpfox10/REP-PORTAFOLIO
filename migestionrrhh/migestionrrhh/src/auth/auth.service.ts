import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsuarioService } from '../modules/usuario/usuario.service'; // Ajusta la ruta según tu proyecto
import { AuthDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly usuarioService: UsuarioService,
    ) { }

    async login(authDto: AuthDto): Promise<{ token: string }> {
        const { email, password } = authDto;
        // Simula la búsqueda de usuario y la verificación de contraseña.
        // En la implementación real, compare la contraseña (hash) y maneja los errores correctamente.
        const usuario = await this.usuarioService.findByEmail(email);
        if (!usuario || password !== 'plaintext') { // Aquí reemplaza la comparación por la lógica real
            throw new UnauthorizedException('Credenciales invalidas');
        }
        // Genera el token JWT (por ejemplo, usando el id y el email)
        const token = this.jwtService.sign({ id: usuario.id, email: usuario.email });
        return { token };
    }
}
