import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import { Usuario } from '../database/models/usuario.model';
import { AuthDto } from '../auth/dto/auth.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    constructor(
        private jwtService: JwtService,
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

    async login(authDto: AuthDto) {
        const usuario = await this.validarUsuario(authDto);

        if (!usuario) {
            throw new UnauthorizedException('Credenciales inválidas');
        }

        const payload = { username: usuario.email, sub: usuario.id, rol: usuario.rol };
        return {
            access_token: this.jwtService.sign(payload),
        };
    }
}