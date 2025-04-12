import { Test, TestingModule } from '@nestjs/testing';
import { CccoodegdebaService } from './cccoodegdeba.service';
import { CCCoodegdeba } from './cccoodegdeba.model';
import { getModelToken } from '@nestjs/sequelize';
import '../../test/utils/test-setup';  // Ajusta la ruta según corresponda

describe('CccoodegdebaService', () => {
    let service: CccoodegdebaService;
    let modelMock: any;

    beforeEach(async () => {
        modelMock = {
            create: jest.fn(dto => Promise.resolve({ id: 1, ...dto, fechaDeAlta: new Date() })),
            findAll: jest.fn(() => Promise.resolve([{ id: 1, descripcion: 'Registro A' }])),
            findByPk: jest.fn().mockImplementation((id: number) => {
                if (id === 1) {
                    return Promise.resolve({
                        id: 1,
                        update: jest.fn().mockResolvedValue({ id: 1, descripcion: 'Actualizado' }),
                        destroy: jest.fn().mockResolvedValue(1),
                    });
                }
                return Promise.resolve(null);
            }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CccoodegdebaService,
                { provide: getModelToken(CCCoodegdeba), useValue: modelMock },
            ],
        }).compile();

        service = module.get<CccoodegdebaService>(CccoodegdebaService);
    });

    it('debería crear un registro', async () => {
        const dto = { descripcion: 'Nuevo registro', usuarioCarga: 'admin' };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería obtener todos los registros', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([{ id: 1, descripcion: 'Registro A' }]);
    });

    it('debería obtener un registro por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('debería actualizar un registro', async () => {
        const dto = { descripcion: 'Actualizado', usuarioCarga: 'admin' };
        const fakeItem = {
            id: 1,
            update: jest.fn().mockResolvedValue({ id: 1, ...dto }),
        };
        modelMock.findByPk.mockResolvedValue(fakeItem);
        const result = await service.actualizar(1, dto);
        expect(fakeItem.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería eliminar un registro', async () => {
        const fakeItem = {
            id: 1,
            destroy: jest.fn().mockResolvedValue(1),
        };
        modelMock.findByPk.mockResolvedValue(fakeItem);
        const result = await service.eliminar(1);
        expect(fakeItem.destroy).toHaveBeenCalled();
        expect(result).toEqual(1);
    });
});
