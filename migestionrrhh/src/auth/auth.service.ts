import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import { Usuario } from '../modules/usuario/usuario.model';
import { AuthDto } from '../auth/dto/auth.dto';
import { UsuarioService } from '../modules/usuario/usuario.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    constructor(
        private jwtService: JwtService,
        private usuarioService: UsuarioService, // ✅ Inyectado correctamente
        @InjectModel(Usuario) private usuarioModel: typeof Usuario,
    ) { }

    async validarUsuario(authDto: AuthDto): Promise<Usuario | null> {
        const usuario = await this.usuarioModel.findOne({
            where: { email: authDto.email },
        });
        if (!usuario) return null;

        const esValido = await bcrypt.compare(authDto.password, usuario.password);
        return esValido ? usuario : null;
    }

    // 🚨 Un único método "login"
    async login(authDto: AuthDto) {
        const usuario = await this.validarUsuario(authDto);

        if (!usuario) {
            throw new UnauthorizedException('Credenciales inválidas');
        }

        const payload = { username: usuario.nombreUsuario, sub: usuario.id, rol: usuario.rol };

        const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
        const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

        // ✅ Guardar refresh token en usuario
        await this.usuarioService.guardarRefreshToken(usuario.id, refreshToken);

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
        };
    }

    // ✅ Refresh Tokens
    async refreshTokens(userId: number, refreshToken: string) {
        const usuario = await this.usuarioService.obtenerPorId(userId);

        if (!usuario || usuario.refreshToken !== refreshToken) {
            throw new UnauthorizedException('Refresh token inválido');
        }

        const payload = { username: usuario.nombreUsuario, sub: usuario.id, rol: usuario.rol };

        const newAccessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
        const newRefreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

        await this.usuarioService.guardarRefreshToken(usuario.id, newRefreshToken);

        return {
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
        };
    }
}
