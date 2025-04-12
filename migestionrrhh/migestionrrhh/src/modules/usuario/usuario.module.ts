import { Module, forwardRef } from '@nestjs/common';
import { UsuarioService } from './usuario.service';
import { UsuarioController } from './usuario.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { Usuario } from './usuario.model';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../../auth/auth.module';

@Module({
    imports: [
        SequelizeModule.forFeature([Usuario]),
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'test_secret',
            signOptions: { expiresIn: '1h' },
        }),
        forwardRef(() => AuthModule),
    ],
    controllers: [UsuarioController],
    providers: [UsuarioService],
    exports: [UsuarioService],
})
export class UsuarioModule { }


