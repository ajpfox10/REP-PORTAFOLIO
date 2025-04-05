// Test end-to-end base
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { AppModule } from '../app.module';

describe('AppController (e2e)', () => {
    let app: INestApplication;
    let sequelize: Sequelize;

    beforeAll(async () => {
        // Aumentamos el tiempo máximo de ejecución, por si la base de datos tarda
        jest.setTimeout(30000);

        // Limpiamos cualquier mock antes de iniciar
        jest.clearAllMocks();

        // Creación y compilación del módulo de prueba con el AppModule
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        // Inicializamos la aplicación
        app = moduleFixture.createNestApplication();
        await app.init();

        // Obtenemos la instancia de Sequelize para sincronizar la base de datos
        sequelize = moduleFixture.get(Sequelize);
        await sequelize.sync();
    });

    it('/ (GET)', async () => {
        // Verificamos que la ruta raíz devuelva un 200 con "Hello World!"
        const response = await request(app.getHttpServer()).get('/').expect(200);
        expect(response.text).toBe('Hello World!');
    });

    afterAll(async () => {
        // Cerramos la conexión y la app al finalizar las pruebas
        await sequelize.close();
        await app.close();
    });
});
