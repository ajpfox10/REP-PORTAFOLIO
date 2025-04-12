import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt'; // Importa el JwtModule para que JwtService est� disponible
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard'; // Aseg�rate de que JwtAuthGuard est� bien importado
import { AuthModule } from '@auth/auth.module'; // Si tienes un m�dulo Auth que contiene el JwtAuthGuard

@Module({
    imports: [
        JwtModule.register({
            secret: 'test-secret',
            signOptions: { expiresIn: '1h' },
        }),
        AuthModule, // Si es necesario para importar la l�gica de autenticaci�n global
    ],
    providers: [
        JwtService, // Aseg�rate de inyectar el JwtService aqu�
        JwtAuthGuard, // Aseg�rate de inyectar el JwtAuthGuard aqu� si lo necesitas
    ],
    exports: [
        JwtService, // Exporta JwtService para que est� disponible en todos los tests
        JwtAuthGuard, // Exporta JwtAuthGuard para que est� disponible en todos los tests
    ],
})
export class BaseTestModule { }
