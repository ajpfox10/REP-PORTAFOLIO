import { Test, TestingModule } from '@nestjs/testing';
import { Ocupacion1Service } from './ocupacion1.service';
import { getModelToken } from '@nestjs/sequelize';
import { Ocupacion1 } from './ocupacion1.model';
import { CrearOcupacion1Dto } from './dto/crear-ocupacion1.dto';
import { ActualizarOcupacion1Dto } from './dto/actualizar-ocupacion1.dto';

describe('Ocupacion1Service', () => {
    let service: Ocupacion1Service;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Ingeniero' }])),
        findByPk: jest.fn(id => Promise.resolve({ id, nombre: 'Ingeniero', update: jest.fn(), destroy: jest.fn() })),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Ocupacion1Service,
                {
                    provide: getModelToken(Ocupacion1),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<Ocupacion1Service>(Ocupacion1Service);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar ocupación creada', async () => {
        const dto: CrearOcupacion1Dto = {
            nombre: 'Ingeniero en Sistemas',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todas las ocupaciones', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Ingeniero' }]);
    });

    it('obtenerPorId() debe retornar una ocupación por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Ingeniero', update: expect.any(Function), destroy: expect.any(Function) });
    });

    it('actualizar() debe actualizar correctamente la ocupación', async () => {
        const dto: ActualizarOcupacion1Dto = {
            nombre: 'Arquitecto',
            usuarioCarga: 'admin',
        };
        const ocupacion = await service.actualizar(1, dto);
        expect(ocupacion).toEqual({ id: 1, nombre: 'Ingeniero', update: expect.any(Function), destroy: expect.any(Function) });
    });

    it('eliminar() debe eliminar correctamente una ocupación', async () => {
        const result = await service.eliminar(1);
        expect(result).toBeUndefined();
    });
});
