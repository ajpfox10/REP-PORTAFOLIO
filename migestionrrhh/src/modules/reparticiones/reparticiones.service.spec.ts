import { Test, TestingModule } from '@nestjs/testing';
import { ReparticionesService } from './reparticiones.service';
import { getModelToken } from '@nestjs/sequelize';
import { Reparticiones } from './reparticiones.model';
import { CrearReparticionesDto } from './dto/crear-reparticiones.dto';
import { ActualizarReparticionesDto } from './dto/actualizar-reparticiones.dto';

describe('ReparticionesService', () => {
    let service: ReparticionesService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, descripcion: dto.nombre, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, descripcion: 'Direcci�n de RRHH' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                descripcion: 'Direcci�n de RRHH',
                usuarioCarga: 'admin',
                fechaDeAlta: new Date(),
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
            }),
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ReparticionesService,
                {
                    provide: getModelToken(Reparticiones),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<ReparticionesService>(ReparticionesService);
    });

    it('deber�a estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe crear una repartici�n', async () => {
        const dto: CrearReparticionesDto = {
            nombre: 'Direcci�n de RRHH',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toHaveProperty('descripcion', dto.nombre);
    });

    it('obtenerTodos() debe retornar todas las reparticiones', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, descripcion: 'Direcci�n de RRHH' }]);
    });

    it('obtenerPorId() debe retornar una repartici�n por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result?.id).toBe(1);
        expect(result?.descripcion).toBe('Direcci�n de RRHH');
    });

    it('actualizar() debe modificar una repartici�n', async () => {
        const dto: ActualizarReparticionesDto = {
            nombre: 'Direcci�n Legal',
            usuarioCarga: 'admin',
        };
        const result = await service.actualizar(1, dto);
        expect(result?.id).toBe(1);
    });

    it('eliminar() debe borrar correctamente una repartici�n', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});

