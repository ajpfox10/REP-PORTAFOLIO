import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Usuario } from '../modules/usuario/usuario.model';
import { ConfigModule } from '@nestjs/config';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({
    path: path.resolve(__dirname, '../../.env'), // 👈 esto asegura que lo lea
});
console.log('✅ ENV LOADED:', {
    DB_USER: process.env.DB_USER,
    DB_PASS: process.env.DB_PASSWORD,
});
@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        SequelizeModule.forRoot({
            dialect: 'mysql',
            host: process.env.DB_HOST || '127.0.0.1',
            port: parseInt(process.env.DB_PORT ?? '3306', 10),
            username: process.env.DB_USER || 'versionfinal',
            password: process.env.DB_PASSWORD || 'ss3900',
            database: process.env.DB_NAME || 'gestionderrhh',
            autoLoadModels: true,
            synchronize: true,
            models: [Usuario],
            logging: false,
        }),
    ],
})
export class DatabaseModule { }
