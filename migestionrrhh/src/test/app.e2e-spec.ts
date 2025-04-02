import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let sequelize: Sequelize;

  beforeAll(async () => {
    jest.setTimeout(30000);
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    sequelize = moduleFixture.get(Sequelize);
    await sequelize.sync();
  });

  it('/ (GET)', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterAll(async () => {
    await sequelize.close(); // Cierra Sequelize
    await app.close();
  });
});
