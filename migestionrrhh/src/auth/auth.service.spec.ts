import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/sequelize';
import { Usuario } from '../database/models/usuario.model';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
    let service: AuthService;
    let usuarioEjemplo: any;
    const mockUsuarioModel = {
        findOne: jest.fn(),
    };

    const mockJwtService = {
        sign: jest.fn().mockReturnValue('jwt-mock-token'),
    };

    beforeAll(async () => {
        usuarioEjemplo = {
            id: 1,
            email: 'correo@ejemplo.com',
            password: await bcrypt.hash('123456', 10),
            rol: 'admin',
        };

        mockUsuarioModel.findOne.mockResolvedValue(usuarioEjemplo);
    });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: JwtService, useValue: mockJwtService },
                { provide: getModelToken(Usuario), useValue: mockUsuarioModel },
            ],
        }).compile();

        service = module.get<AuthService>(AuthService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('debería retornar un token válido al loguear', async () => {
        const result = await service.login({
            email: 'correo@ejemplo.com',
            password: '123456',
        });
        expect(result).toEqual({ access_token: 'jwt-mock-token' });
    });
});
