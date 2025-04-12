import { Test, TestingModule } from '@nestjs/testing';
import { LeyesService } from './leyes.service';
import { getModelToken } from '@nestjs/sequelize';
import { Ley } from './leyes.model';
import { CrearLeyDto } from './dto/crear-ley.dto';
import { ActualizarLeyDto } from './dto/actualizar-ley.dto';
import '../../test/utils/test-setup';

describe('LeyesService', () => {
    let service: LeyesService;

    const mockItem = {
        id: 1,
        Ley: 'Ley A',
        codigoleyes: 1001,
        leyactiva: 1,
        usuarioCarga: 'admin',
        update: jest.fn().mockResolvedValue({
            id: 1,
            Ley: 'Ley Actualizada',
            codigoleyes: 2002,
            leyactiva: 1,
            usuarioCarga: 'editor',
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([mockItem])),
        findByPk: jest.fn(id => Promise.resolve(mockItem)),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

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
        const dto = {
            Ley: 'Ley A',
            codigoleyes: 1001,
            usuarioCarga: 'admin',
            leyactiva: 1,
        };

        const resultMock = { id: 1, ...dto, fechaDeAlta: new Date() };

        mockModel.create.mockResolvedValue(resultMock);

        const result = await service.crear(dto);

        expect(result).toEqual(resultMock);
        expect(mockModel.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
    });



    it('obtenerTodos() debe retornar todas las leyes', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([mockItem]);
        expect(mockModel.findAll).toHaveBeenCalled();
    });

    it('obtenerPorId() debe retornar la ley correspondiente', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual(mockItem);
        expect(mockModel.findByPk).toHaveBeenCalledWith(1);
    });

    it('actualizar() debe retornar la ley actualizada', async () => {
        const dto: ActualizarLeyDto = {
            Ley: 'Ley Actualizada',
            codigoleyes: 2002,
            leyactiva: 1,
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(mockItem.update).toHaveBeenCalledWith(dto);
        expect(result).toEqual({
            id: 1,
            ...dto,
        });
    });

    it('eliminar() debe ejecutar destroy correctamente', async () => {
        const result = await service.eliminar(1);
        expect(mockItem.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
