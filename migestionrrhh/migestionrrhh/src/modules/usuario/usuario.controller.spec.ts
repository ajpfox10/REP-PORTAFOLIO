import { Test, TestingModule } from '@nestjs/testing';
import { UsuarioController } from './usuario.controller';
import { UsuarioService } from './usuario.service';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { CreateUsuarioDto } from './dto/usuario.dto';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';

describe('UsuarioController', () => {
    let controller: UsuarioController;
    const mockService = {
        crearUsuario: jest.fn(dto => ({
            id: 1,
            ...dto,
            password: undefined // Normalmente no se devuelve el password
        })),
        obtenerTodos: jest.fn(() => [{
            id: 1,
            nombreUsuario: 'juanito',
            email: 'juan@example.com'
        }]),
        obtenerPorId: jest.fn(id => ({
            id,
            nombreUsuario: 'juanito',
            email: 'juan@example.com'
        })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsuarioController],
            providers: [
                { provide: UsuarioService, useValue: mockService },
                {
                    provide: JwtService,
                    useValue: {
                        sign: () => 'token',
                        verify: () => ({ id: 1 }),
                    },
                },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<UsuarioController>(UsuarioController);
    });

    it('debería crear un usuario', async () => {
        const dto: CreateUsuarioDto = {
            nombreUsuario: 'juanito',
            email: 'juan@example.com',
            password: '123456',
            servicio: 'TI',
            sector: 'Soporte',
            rol: 'admin',
            lvl: 1,
        };

        const result = await controller.crear(dto);
        expect(result).toEqual({
            id: 1,
            ...dto,
            password: undefined
        });
        expect(mockService.crearUsuario).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todos los usuarios', async () => {
        const result = await controller.findAll();
        expect(result).toEqual([{
            id: 1,
            nombreUsuario: 'juanito',
            email: 'juan@example.com'
        }]);
        expect(mockService.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener un usuario por ID', async () => {
        const result = await controller.findOne(1);
        expect(result).toEqual({
            id: 1,
            nombreUsuario: 'juanito',
            email: 'juan@example.com'
        });
        expect(mockService.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar un usuario', async () => {
        const dto: ActualizarUsuarioDto = {
            email: 'juanactualizado@example.com',
            nombreUsuario: 'juanito2',
        };

        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(mockService.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar un usuario', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ deleted: true });
        expect(mockService.eliminar).toHaveBeenCalledWith(1);
    });
});