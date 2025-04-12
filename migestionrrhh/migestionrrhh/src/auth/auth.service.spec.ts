import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { AuthDto } from './dto/auth.dto';
import { UsuarioService } from '../modules/usuario/usuario.service'; // Ajusta la ruta según tu proyecto

describe('AuthService', () => {
    let authService: AuthService;

    const mockJwtService = {
        sign: jest.fn(() => 'signedToken'),
    };

    const mockUsuarioService = {
        findByEmail: jest.fn((email: string) =>
            Promise.resolve({ id: 1, email, password: 'plaintext' })
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: JwtService, useValue: mockJwtService },
                { provide: UsuarioService, useValue: mockUsuarioService },
            ],
        }).compile();

        authService = module.get<AuthService>(AuthService);
    });

    it('should be defined', () => {
        expect(authService).toBeDefined();
    });

    it('should return a valid token on login', async () => {
        const authDto: AuthDto = { email: 'test@example.com', password: 'plaintext' };

        // Llama al método login del servicio
        const result = await authService.login(authDto);

        // Verifica que se haya llamado el método findByEmail con el email correcto
        expect(mockUsuarioService.findByEmail).toHaveBeenCalledWith('test@example.com');
        // Verifica que jwtService.sign haya sido llamado
        expect(mockJwtService.sign).toHaveBeenCalled();
        // Ahora se espera un objeto { token: 'signedToken' }
        expect(result).toEqual({ token: 'signedToken' });
    });

    // Aquí puedes agregar más tests para otros escenarios, como credenciales inválidas.
});
