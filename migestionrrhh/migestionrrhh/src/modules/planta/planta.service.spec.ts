import { Test, TestingModule } from '@nestjs/testing';
import { PlantaService } from './planta.service';
import { Planta } from './planta.model';
import { getModelToken } from '@nestjs/sequelize';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';

describe('PlantaService', () => {
    let service: PlantaService;
    let modelMock: any;

    const plantaMock = {
        id: 1,
        nombre: 'Planta Central',
        usuarioCarga: 'admin',
        fechaDeAlta: new Date(),
        update: jest.fn().mockResolvedValue({
            id: 1,
            nombre: 'Planta Modificada',
            usuarioCarga: 'admin',
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        modelMock = {
            create: jest.fn().mockResolvedValue(plantaMock),
            findAll: jest.fn().mockResolvedValue([plantaMock]),
            findByPk: jest.fn().mockResolvedValue(plantaMock),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PlantaService,
                { provide: getModelToken(Planta), useValue: modelMock },
            ],
        }).compile();

        service = module.get<PlantaService>(PlantaService);
    });

    it('debería crear una planta', async () => {
        const dto = {
            nombre: 'Planta Central',
            usuarioCarga: 'admin',
            fechaDeAlta: new Date(), // ✅ requerido
        };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toEqual(plantaMock);
    });

    it('debería obtener todas las plantas', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([plantaMock]);
    });

    it('debería obtener una planta por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(plantaMock);
    });

    it('debería lanzar NotFoundException si la planta no existe', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('debería actualizar una planta', async () => {
        const dto = { nombre: 'Planta Modificada' };
        modelMock.findByPk.mockResolvedValue(plantaMock);
        const result = await service.actualizar(1, dto);
        expect(plantaMock.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería eliminar una planta correctamente', async () => {
        modelMock.findByPk.mockResolvedValue(plantaMock);
        const result = await service.eliminar(1);
        expect(plantaMock.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});

