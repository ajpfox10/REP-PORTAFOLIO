import { Test, TestingModule } from '@nestjs/testing';
import { LeyesService } from './leyes.service';
import { getModelToken } from '@nestjs/sequelize';
import { Ley } from './leyes.model';
import { CrearLeyDto } from './dto/crear-ley.dto';
import { ActualizarLeyDto } from './dto/actualizar-ley.dto';

describe('LeyesService', () => {
    let service: LeyesService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, Ley: 'Ley A' }])),
        findByPk: jest.fn(id => Promise.resolve({ id, Ley: 'Ley A' })),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                LeyesService,
                {
                    provide: getModelToken(Ley),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<LeyesService>(LeyesService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar una nueva ley', async () => {
        const dto: CrearLeyDto = {
            Ley: 'Ley A',
            codigoleyes: 1001,
            leyactiva: 1,
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todas las leyes', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, Ley: 'Ley A' }]);
    });

    it('obtenerPorId() debe retornar la ley correspondiente', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, Ley: 'Ley A' });
    });

    it('actualizar() debe retornar el resultado de actualización', async () => {
        const dto: ActualizarLeyDto = {
            Ley: 'Ley Actualizada',
            codigoleyes: 2002,
            leyactiva: 1,
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toEqual([1]);
    });

    it('eliminar() debe retornar éxito al eliminar', async () => {
        const result = await service.eliminar(1);
        expect(result).toEqual(1);
    });
});
