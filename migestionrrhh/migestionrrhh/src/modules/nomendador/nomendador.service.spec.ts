import { Test, TestingModule } from '@nestjs/testing';
import { NomendadorService } from './nomendador.service';
import { Nomendador } from './nomendador.model';
import { getModelToken } from '@nestjs/sequelize';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';

describe('NomendadorService', () => {
    let service: NomendadorService;
    let modelMock: any;

    const nomendadorMock = {
        id: 1,
        nombre: 'Nomendador A',
        usuarioCarga: 'admin',
        fechaDeAlta: new Date(),
        update: jest.fn().mockResolvedValue({
            id: 1,
            nombre: 'Nomendador Actualizado',
            usuarioCarga: 'admin',
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        modelMock = {
            create: jest.fn().mockResolvedValue(nomendadorMock),
            findAll: jest.fn().mockResolvedValue([nomendadorMock]),
            findByPk: jest.fn().mockResolvedValue(nomendadorMock),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                NomendadorService,
                { provide: getModelToken(Nomendador), useValue: modelMock },
            ],
        }).compile();

        service = module.get<NomendadorService>(NomendadorService);
    });

    it('debería crear un nomendador', async () => {
        const dto = {
            nombre: 'Nomendador A',
            usuarioCarga: 'admin',
            fechaDeAlta: new Date(), // ✅ requerido por el DTO
        };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toEqual(nomendadorMock);
    });

    it('debería obtener todos los nomendadores', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([nomendadorMock]);
    });

    it('debería obtener un nomendador por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(nomendadorMock);
    });

    it('debería lanzar NotFoundException si no encuentra el nomendador', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('debería actualizar un nomendador correctamente', async () => {
        const dto = { nombre: 'Nomendador Actualizado' };
        modelMock.findByPk.mockResolvedValue(nomendadorMock);

        const result = await service.actualizar(1, dto);
        expect(nomendadorMock.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería eliminar un nomendador sin errores', async () => {
        modelMock.findByPk.mockResolvedValue(nomendadorMock);
        const result = await service.eliminar(1);
        expect(nomendadorMock.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
