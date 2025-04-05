// Test unitario para usuario.controller
import { Test, TestingModule } from '@nestjs/testing';
import { UsuarioController } from './usuario.controller';
import { UsuarioService } from './usuario.service';
import { CreateUsuarioDto } from './dto/usuario.dto';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';

describe('UsuarioController', () => {
    let controller: UsuarioController;
    let service: UsuarioService;

    const mockService = {
        crearUsuario: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombreUsuario: 'admin', email: 'admin@example.com' }]),
        obtenerPorId: jest.fn(id => ({ id, nombreUsuario: 'admin', email: 'admin@example.com' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsuarioController],
            providers: [{ provide: UsuarioService, useValue: mockService }],
        }).compile();

        controller = module.get<UsuarioController>(UsuarioController);
        service = module.get<UsuarioService>(UsuarioService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el usuario creado', async () => {
        const dto: CreateUsuarioDto = {
            nombreUsuario: 'admin',
            email: 'admin@example.com',
            servicio: 'Sistemas',
            sector: 'IT',
            rol: 'admin',
            lvl: 1,
            password: 'Password123',
        };
        const result = await controller.crear(dto);
        expect(result).toEqual(expect.objectContaining({ nombreUsuario: 'admin' }));
    });

    it('obtenerTodos() debe retornar todos los usuarios', async () => {
        const result = await controller.findAll();
        expect(result).toEqual([{ id: 1, nombreUsuario: 'admin', email: 'admin@example.com' }]);
    });

    it('obtenerPorId() debe retornar un usuario específico', async () => {
        const result = await controller.findOne('1');
        expect(result).toEqual(expect.objectContaining({ id: 1, email: 'admin@example.com' }));
    });

    it('actualizar() debe retornar el usuario actualizado', async () => {
        const dto: ActualizarUsuarioDto = {
            nombreUsuario: 'nuevoAdmin',
        };
        const result = await controller.actualizar('1', dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar eliminación', async () => {
        const result = await controller.eliminar('1');
        expect(result).toEqual({ deleted: true });
    });
});
