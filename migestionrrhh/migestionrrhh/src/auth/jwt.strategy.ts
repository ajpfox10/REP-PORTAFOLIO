import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsuarioService } from '../modules/usuario/usuario.service'; // 📌 RUTA CORRECTA
import { Usuario } from '../modules/usuario/usuario.model'; // 📌 RUTA CORRECTA

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private usuarioService: UsuarioService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: process.env.JWT_SECRET || 'secretoSuperSeguro',
        });
    }

    async validate(payload: { id: number; email: string; rol: string }): Promise<Usuario | null> {
        const usuario = await this.usuarioService.obtenerPorId(payload.id); // 📌 Validar que `obtenerPorId` exista
        if (!usuario) {
            throw new Error('Usuario no encontrado');
        }
        return usuario;
    }
}
