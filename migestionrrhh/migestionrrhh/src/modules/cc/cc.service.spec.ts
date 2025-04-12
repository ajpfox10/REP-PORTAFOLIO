import { Test, TestingModule } from '@nestjs/testing';
import { CcService } from './cc.service';
import { Cc } from './cc.model';
import { getModelToken } from '@nestjs/sequelize';
import '../../test/utils/test-setup';  // Ajusta la ruta según corresponda

describe('CcService', () => {
    let service: CcService;
    let model: typeof Cc;

    const mockCc = {
        id: 1,
        nombre: 'CC Ejemplo',
        update: jest.fn().mockResolvedValue({ id: 1, nombre: 'Actualizado' }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    const mockModel = {
        create: jest.fn().mockResolvedValue(mockCc),
        findAll: jest.fn().mockResolvedValue([mockCc]),
        findByPk: jest.fn().mockResolvedValue(mockCc),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CcService,
                { provide: getModelToken(Cc), useValue: mockModel },
            ],
        }).compile();

        service = module.get<CcService>(CcService);
        model = module.get<typeof Cc>(getModelToken(Cc));
    });

    it('debería crear una CC', async () => {
        const dto = { nombre: 'Nueva CC', fechaDeAlta: new Date(), usuarioCarga: 'admin' };
        const result = await service.crear(dto);
        expect(result).toEqual(mockCc);
        expect(mockModel.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
    });

    it('debería obtener todas las CC', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([mockCc]);
        expect(mockModel.findAll).toHaveBeenCalled();
    });

    it('debería obtener CC por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual(expect.objectContaining({ id: 1 }));
        expect(mockModel.findByPk).toHaveBeenCalledWith(1);
    });

    it('debería actualizar una CC', async () => {
        const dto = { nombre: 'Actualizado' };
        // Simulamos que findByPk devuelve un objeto con update
        const fakeItem = { id: 1, update: jest.fn().mockResolvedValue({ id: 1, ...dto }) };
        mockModel.findByPk.mockResolvedValue(fakeItem);

        const result = await service.actualizar(1, dto);
        expect(fakeItem.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería eliminar una CC', async () => {
        const fakeItem = { id: 1, destroy: jest.fn().mockResolvedValue(undefined) };
        mockModel.findByPk.mockResolvedValue(fakeItem);

        await service.eliminar(1);
        expect(fakeItem.destroy).toHaveBeenCalled();
    });
});
