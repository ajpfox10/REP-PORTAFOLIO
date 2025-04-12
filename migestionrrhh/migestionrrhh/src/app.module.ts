import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsuarioModule } from './modules/usuario/usuario.module';
import { AuthModule } from './auth/auth.module';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule } from '@nestjs/config';
import { Usuario } from './modules/usuario/usuario.model';
import { LoggerModule } from 'nestjs-pino';
import { SentryModule } from '@ntegral/nestjs-sentry';

@Module({
    imports: [

        SentryModule.forRoot({
            dsn: process.env.SENTRY_DSN, // Poné tu DSN real de Sentry aquí
            environment: process.env.NODE_ENV || 'development',
            debug: false,
            tracesSampleRate: 1.0, // Para seguimiento de performance (opcional)
            logLevels: ['error', 'warn'], // logs automáticos de errores y advertencias
        }),

        LoggerModule.forRoot({
            pinoHttp: {
                transport: process.env.NODE_ENV !== 'production'
                    ? { target: 'pino-pretty' } // Para logs bonitos en desarrollo
                    : undefined,
                level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
                autoLogging: true,
            },
        }),

        ConfigModule.forRoot({ isGlobal: true }),
        SequelizeModule.forRoot({
            dialect: 'mysql',
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT ?? '3306', 10),
            username: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'ss3900',
            database: process.env.DB_NAME || 'nest_db',
            autoLoadModels: true,
            synchronize: true,
            models: [Usuario],
            logging: false,
        }),
        UsuarioModule,
        AuthModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule { }