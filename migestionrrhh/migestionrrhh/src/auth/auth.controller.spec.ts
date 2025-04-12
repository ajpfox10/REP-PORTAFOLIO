import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthDto } from './dto/auth.dto';

describe('AuthController', () => {
    let authController: AuthController;
    let authService: AuthService;

    const mockAuthService = {
        login: jest.fn().mockResolvedValue({ token: 'token_generado' }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [{ provide: AuthService, useValue: mockAuthService }],
        }).compile();

        authController = module.get<AuthController>(AuthController);
        authService = module.get<AuthService>(AuthService);
    });

    it('debería estar definido', () => {
        expect(authController).toBeDefined();
    });

    it('login() debe retornar un token', async () => {
        const authDto: AuthDto = { email: 'test@test.com', password: 'plaintext' };
        const result = await authController.login(authDto);
        expect(result).toEqual({ token: 'token_generado' });
        expect(mockAuthService.login).toHaveBeenCalledWith(authDto);
    });
});

