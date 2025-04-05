import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { IpFilter, IpDeniedError } from 'express-ipfilter';
import { Request, Response, NextFunction } from 'express';
import { Logger } from 'nestjs-pino';
async function bootstrap() {
    //const app = await NestFactory.create(AppModule);
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    // 🛡️ Seguridad de Headers HTTP con Helmet
    app.use(helmet());

    // 🚦 Protección Rate Limit por IP
    app.use(
        rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutos
            max: 100,                 // máximo 100 solicitudes por IP
            message: '🚫 Demasiadas peticiones desde esta IP. Inténtalo más tarde.',
            standardHeaders: true,
            legacyHeaders: false,
        }),
    );

    // ⛔ Bloqueo directo por IPs específicas (modifica según necesidad)
    const deniedIps = ['123.45.67.89']; // IPs bloqueadas
    app.use(
        IpFilter(deniedIps, {
            mode: 'deny',
            detectIp: (req: Request) => req.ip || '0.0.0.0',

        }),
    );

    // ❗ Manejo global del error por IP bloqueada
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
        if (err instanceof IpDeniedError) {
            return res.status(403).json({ message: 'IP bloqueada por seguridad' });
        }
        next(err);
    });

    // ✅ Validaciones globales estrictas con DTOs
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    // 📘 Swagger únicamente habilitado en desarrollo
    if (process.env.NODE_ENV !== 'production') {
        const config = new DocumentBuilder()
            .setTitle('Mi Gestión RRHH')
            .setDescription('Documentación de la API de Recursos Humanos')
            .setVersion('1.0')
            .addBearerAuth()
            .build();

        const document = SwaggerModule.createDocument(app, config);
        SwaggerModule.setup('api', app, document);
    }

    // 🔒 Configuración segura de CORS
    app.enableCors({
        origin: ['https://tu-dominio.com'],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true,
    });

    // ✅ Usa nestjs-pino globalmente:
    app.useLogger(app.get(Logger));

    await app.listen(process.env.PORT || 3000);
}
bootstrap();
