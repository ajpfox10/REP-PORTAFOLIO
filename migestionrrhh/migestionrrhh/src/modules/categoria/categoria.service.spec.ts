import { Test, TestingModule } from '@nestjs/testing';
import { CategoriaService } from './categoria.service';
import { Categoria } from './categoria.model';
import { getModelToken } from '@nestjs/sequelize';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';  // Ajusta la ruta según corresponda

describe('CategoriaService', () => {
    let service: CategoriaService;
    let modelMock: any;

    beforeEach(async () => {
        modelMock = {
            create: jest.fn(dto => Promise.resolve({ id: 1, ...dto, fechaDeAlta: new Date() })),
            findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Test' }])),
            findByPk: jest.fn(id => {
                if (id === 1) {
                    return Promise.resolve({ id, update: jest.fn().mockResolvedValue({ id, nombre: 'Actualizado' }), destroy: jest.fn() });
                }
                return Promise.resolve(null);
            }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CategoriaService,
                { provide: getModelToken(Categoria), useValue: modelMock },
            ],
        }).compile();

        service = module.get<CategoriaService>(CategoriaService);
    });

    it('debería crear una categoría', async () => {
        const dto = { nombre: 'Nueva Categoria', descripcion: 'Descripcion' };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería obtener todas las categorías', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([{ id: 1, nombre: 'Test' }]);
    });

    it('debería obtener una categoría por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('debería lanzar error si no existe la categoría', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('debería actualizar una categoría', async () => {
        const dto = { nombre: 'Actualizado' };
        const fakeCategoria = { id: 1, update: jest.fn().mockResolvedValue({ id: 1, ...dto }) };
        modelMock.findByPk.mockResolvedValue(fakeCategoria);
        const result = await service.actualizar(1, dto);
        expect(fakeCategoria.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería eliminar una categoría', async () => {
        const fakeCategoria = { id: 1, destroy: jest.fn().mockResolvedValue(undefined) };
        modelMock.findByPk.mockResolvedValue(fakeCategoria);
        await service.eliminar(1);
        expect(fakeCategoria.destroy).toHaveBeenCalled();
    });
});
