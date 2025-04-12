import { Test, TestingModule } from '@nestjs/testing';
import { Ocupacion1Service } from './ocupacion1.service';
import { NotFoundException } from '@nestjs/common';
import { Ocupacion1 } from './ocupacion1.model'; // o la ruta correcta
import { getModelToken } from '@nestjs/sequelize';

describe('Ocupacion1Service', () => {
    let service: Ocupacion1Service;
    const ocupacionMock = {
        update: jest.fn(),
        destroy: jest.fn(),
    };
    const modelMock = {
        create: jest.fn(),
        findAll: jest.fn().mockResolvedValue([ocupacionMock]),
        findByPk: jest.fn().mockResolvedValue(ocupacionMock),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Ocupacion1Service,
                { provide: getModelToken(Ocupacion1), useValue: modelMock }
            ],
        }).compile();

        service = module.get<Ocupacion1Service>(Ocupacion1Service);
    });

    it('deber�a crear una ocupaci�n', async () => {
        const dto = {
            nombre: 'Ingeniero en Sistemas',
            usuarioCarga: 'admin',
        };

        const expected = {
            id: 1,
            ...dto,
            fechaDeAlta: new Date(),
        };

        modelMock.create.mockResolvedValue(expected);

        const result = await service.crear(dto);

        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toEqual(expected);
    });

    it('deber�a actualizar la ocupaci�n correctamente', async () => {
        const updateDto = { nombre: 'Ingeniero Actualizado' };

        ocupacionMock.update.mockResolvedValue({ id: 1, ...updateDto });
        modelMock.findByPk.mockResolvedValue(ocupacionMock);

        const result = await service.actualizar(1, updateDto);

        expect(ocupacionMock.update).toHaveBeenCalledWith(updateDto);
        expect(result).toMatchObject({ id: 1, ...updateDto });
    });

    it('deber�a lanzar NotFoundException si no se encuentra la ocupaci�n', async () => {
        modelMock.findByPk.mockResolvedValue(null);

        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('deber�a eliminar la ocupaci�n correctamente', async () => {
        modelMock.findByPk.mockResolvedValue(ocupacionMock);

        const result = await service.eliminar(1);

        expect(ocupacionMock.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
