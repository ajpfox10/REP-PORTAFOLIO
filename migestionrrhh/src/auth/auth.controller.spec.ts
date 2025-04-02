import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '@auth/auth.controller';
import { AuthService } from '@auth/auth.service';
import { AuthDto } from '@auth/dto/auth.dto';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
describe('AuthController', () => {
    let controller: AuthController;
    let service: AuthService;

    const mockAuthService = {
        login: jest.fn().mockImplementation((dto: AuthDto) => {
            return { access_token: 'fake-jwt-token' };
        }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [
                {
                    provide: AuthService,
                    useValue: mockAuthService,
                },
            ],
        }).compile();

        controller = module.get<AuthController>(AuthController);
        service = module.get<AuthService>(AuthService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('debería retornar un token al hacer login', async () => {
        const dto: AuthDto = { email: 'test@correo.com', password: '123456' };
        const result = await controller.login(dto);
        expect(result).toEqual({ access_token: 'fake-jwt-token' });
        expect(service.login).toHaveBeenCalledWith(dto);
    });
});
