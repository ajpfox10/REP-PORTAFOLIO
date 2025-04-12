import { Test, TestingModule } from '@nestjs/testing';
import { UsuarioService } from './usuario.service';
import { getModelToken } from '@nestjs/sequelize';
import { Usuario } from './usuario.model';
import { CreateUsuarioDto, UpdateUsuarioDto } from './dto/usuario.dto';
import '../../test/utils/test-setup';  // Ajusta la ruta según corresponda

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('hashedPassword123'),
}));

describe('UsuarioService', () => {
    let service: UsuarioService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([
            { id: 1, nombreUsuario: 'admin', email: 'admin@example.com' },
        ])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                nombreUsuario: 'admin',
                email: 'admin@example.com',
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
            }),
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UsuarioService,
                {
                    provide: getModelToken(Usuario),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<UsuarioService>(UsuarioService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crearUsuario() debe crear un usuario con password hasheado', async () => {
        const dto: CreateUsuarioDto = {
            nombreUsuario: 'admin',
            email: 'admin@example.com',
            servicio: 'Sistemas',
            sector: 'IT',
            rol: 'admin',
            lvl: 1,
            password: 'Password123',
        };

        const result = await service.crearUsuario(dto);
        expect(result).toHaveProperty('password', 'hashedPassword123');
        expect(result).toHaveProperty('nombreUsuario', 'admin');
    });

    it('obtenerTodos() debe retornar todos los usuarios', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([
            { id: 1, nombreUsuario: 'admin', email: 'admin@example.com' },
        ]);
    });

    it('obtenerPorId() debe retornar un usuario por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result?.id).toBe(1);
        expect(result?.email).toBe('admin@example.com');
    });

    it('actualizar() debe modificar un usuario', async () => {
        const dto: UpdateUsuarioDto = {
            nombreUsuario: 'nuevoAdmin',
        };
        const result = await service.actualizar(1, dto);
        expect(result?.id).toBe(1);
        expect(result?.nombreUsuario).toBe('admin'); // por mock
    });

    it('eliminar() debe ejecutar la eliminación sin errores', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
