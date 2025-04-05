import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { Usuario } from '../modules/usuario/usuario.model';
import { JwtStrategy } from './jwt.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsuarioModule } from '../modules/usuario/usuario.module'; // 👈 Importar módulo
import { forwardRef} from '@nestjs/common';
@Module({
    imports: [
        PassportModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get<string>('JWT_SECRET') || 'secretoSuperSeguro',
                signOptions: { expiresIn: '1h' },
            }),
            inject: [ConfigService],
        }),
        SequelizeModule.forFeature([Usuario]),
        ConfigModule,
        forwardRef(() => UsuarioModule), // 👈 💥 cambio clave
    ],
    providers: [AuthService, JwtStrategy],
    controllers: [AuthController],
    exports: [JwtModule], // 👈 ¡ESTO ES CLAVE!
})
export class AuthModule { }
