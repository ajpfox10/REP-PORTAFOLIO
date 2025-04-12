import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET, // Asegúrate de tener esta variable en `.env`
            signOptions: { expiresIn: '1h' },
        }),
    ],
    providers: [AuthService, JwtStrategy],
    exports: [AuthService, JwtModule], // 👈 Esto es clave
})
export class AuthModule { }

