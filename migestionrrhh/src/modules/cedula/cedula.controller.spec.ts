import { Test, TestingModule } from '@nestjs/testing';
import { CedulaService } from './cedula.service';
import { getModelToken } from '@nestjs/sequelize';
import { Cedula } from './cedula.model';
import { CrearCedulaDto } from './dto/cedula.dto';
import { ActualizarCedulaDto } from './dto/actualizar-cedula.dto';

describe('CedulaService', () => {
    let service: CedulaService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() =>
            Promise.resolve([{ id: 1, numero: '123', titular: 'Juan Pérez', usuarioCarga: 'admin' }]),
        ),
        findByPk: jest.fn(id =>
            Promise.resolve({ id, numero: '123', titular: 'Juan Pérez', usuarioCarga: 'admin' }),
        ),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CedulaService,
                {
                    provide: getModelToken(Cedula),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<CedulaService>(CedulaService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar el nuevo registro', async () => {
        const dto: CrearCedulaDto = {
            numero: '123',
            fechaEmision: new Date('2024-03-31'),
            titular: 'Juan Pérez',
            domicilio: 'Domicilio ejemplo',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los registros', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, numero: '123', titular: 'Juan Pérez', usuarioCarga: 'admin' }]);
    });

    it('obtenerPorId() debe retornar el objeto esperado', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, numero: '123', titular: 'Juan Pérez', usuarioCarga: 'admin' });
    });

    it('actualizar() debe retornar éxito de actualización', async () => {
        const dto: ActualizarCedulaDto = {
            numero: '456',
            fechaEmision: new Date('2024-04-01'),
            titular: 'Maria López',
            domicilio: 'Otro domicilio',
            usuarioCarga: 'admin',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toEqual([1]);
    });

    it('eliminar() debe retornar éxito al eliminar', async () => {
        const result = await service.eliminar(1);
        expect(result).toEqual(1);
    });
});
