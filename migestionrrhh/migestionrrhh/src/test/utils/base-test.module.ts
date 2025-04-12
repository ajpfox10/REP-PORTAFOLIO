import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt'; // Importa el JwtModule para que JwtService esté disponible
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard'; // Asegúrate de que JwtAuthGuard esté bien importado
import { AuthModule } from '@auth/auth.module'; // Si tienes un módulo Auth que contiene el JwtAuthGuard

@Module({
    imports: [
        JwtModule.register({
            secret: 'test-secret',
            signOptions: { expiresIn: '1h' },
        }),
        AuthModule, // Si es necesario para importar la lógica de autenticación global
    ],
    providers: [
        JwtService, // Asegúrate de inyectar el JwtService aquí
        JwtAuthGuard, // Asegúrate de inyectar el JwtAuthGuard aquí si lo necesitas
    ],
    exports: [
        JwtService, // Exporta JwtService para que esté disponible en todos los tests
        JwtAuthGuard, // Exporta JwtAuthGuard para que esté disponible en todos los tests
    ],
})
export class BaseTestModule { }
