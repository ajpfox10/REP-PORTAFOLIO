// Test unitario para personal.service
import { Test, TestingModule } from '@nestjs/testing';
import { PersonalService } from './personal.service';
import { getModelToken } from '@nestjs/sequelize';
import { Personal } from './personal.model';
import { CreatePersonalDto } from './dto/personal.dto';
import { ActualizarPersonalDto } from './dto/actualizar-personal.dto';

describe('PersonalService', () => {
    let service: PersonalService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ CODIGOCLI: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ CODIGOCLI: 1, nombre: 'Juan' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                CODIGOCLI: id,
                nombre: 'Juan',
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
            }),
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PersonalService,
                {
                    provide: getModelToken(Personal),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<PersonalService>(PersonalService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe crear y retornar un registro de personal', async () => {
        const dto: CreatePersonalDto = {
            nombre: 'Juan',
            apellido: 'Pérez',
            dni: '12345678',
            sexo: 'Masculino',
            cargo: 'Operario',
            usuarioCarga: 'admin',
            fechaNacimiento: new Date('1990-01-01'),
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ CODIGOCLI: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los registros', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ CODIGOCLI: 1, nombre: 'Juan' }]);
    });

    it('obtenerPorId() debe retornar un registro específico', async () => {
        const result = await service.obtenerPorId(1);
        expect(result.CODIGOCLI).toBe(1);
        expect(result.nombre).toBe('Juan');
    });

    it('actualizar() debe actualizar los datos de personal', async () => {
        const dto: ActualizarPersonalDto = {
            nombre: 'Carlos',
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result.CODIGOCLI).toBe(1);
    });

    it('eliminar() debe eliminar un registro sin errores', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
