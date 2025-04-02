import { Module } from '@nestjs/common';
import { UsuarioService } from './usuario.service';
import { UsuarioController } from './usuario.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { Usuario } from '../../database/models/usuario.model';
import { JwtModule } from '@nestjs/jwt';
import { forwardRef} from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module'; // 👈 Importar módulo de auth

@Module({
    imports: [
        SequelizeModule.forFeature([Usuario]),
        JwtModule.register({}), // aunque sea vacío, habilita la inyección
        forwardRef(() => AuthModule), // 👈 NECESARIO para usar JwtService desde JwtAuthGuard
    ],
    controllers: [UsuarioController],
    providers: [UsuarioService],
    exports: [UsuarioService], // 👈 NECESARIO para usarlo fuera del módulo
})
export class UsuarioModule { }

