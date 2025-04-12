import { Test, TestingModule } from '@nestjs/testing';
import { Localidades1Service } from './localidades1.service';
import { Localidades1 } from './localidades1.model';
import { getModelToken } from '@nestjs/sequelize';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';

describe('Localidades1Service', () => {
    let service: Localidades1Service;
    let modelMock: any;

    const localidadMock = {
        id: 1,
        nombre: 'Localidad Nueva',
        descripcion: 'Una ciudad costera',
        usuarioCarga: 'admin',
        update: jest.fn().mockResolvedValue({
            id: 1,
            nombre: 'Localidad Actualizada',
            usuarioCarga: 'admin',
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        modelMock = {
            create: jest.fn().mockResolvedValue(localidadMock),
            findAll: jest.fn().mockResolvedValue([localidadMock]),
            findByPk: jest.fn().mockResolvedValue(localidadMock),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Localidades1Service,
                { provide: getModelToken(Localidades1), useValue: modelMock },
            ],
        }).compile();

        service = module.get<Localidades1Service>(Localidades1Service);
    });

    it('debería crear una nueva localidad', async () => {
        const dto = {
            nombre: 'Localidad Nueva',
            descripcion: 'Una ciudad costera',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toMatchObject(localidadMock);
    });

    it('debería obtener todas las localidades', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([localidadMock]);
    });

    it('debería obtener una localidad por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(localidadMock);
    });

    it('debería lanzar NotFoundException si la localidad no existe', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('debería actualizar una localidad correctamente', async () => {
        const dto = { nombre: 'Localidad Actualizada' };
        modelMock.findByPk.mockResolvedValue(localidadMock);

        const result = await service.actualizar(1, dto);
        expect(localidadMock.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería eliminar una localidad correctamente', async () => {
        modelMock.findByPk.mockResolvedValue(localidadMock);
        const result = await service.eliminar(1);
        expect(localidadMock.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});

