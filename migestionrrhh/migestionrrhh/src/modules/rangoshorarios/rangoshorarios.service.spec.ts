import { Test, TestingModule } from '@nestjs/testing';
import { RangoshorariosService } from './rangoshorarios.service';
import { getModelToken } from '@nestjs/sequelize';
import { Rangoshorarios } from './rangoshorarios.model';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';

describe('RangoshorariosService', () => {
    let service: RangoshorariosService;
    let modelMock: any;

    const mockRango = {
        id: 1,
        nombre: 'Turno Ma�ana',
        usuarioCarga: 'admin',
        fechaDeAlta: new Date(),
        update: jest.fn().mockResolvedValue({
            id: 1,
            nombre: 'Turno Modificado',
            usuarioCarga: 'admin',
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        modelMock = {
            create: jest.fn().mockResolvedValue(mockRango),
            findAll: jest.fn().mockResolvedValue([mockRango]),
            findByPk: jest.fn().mockResolvedValue(mockRango),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RangoshorariosService,
                { provide: getModelToken(Rangoshorarios), useValue: modelMock },
            ],
        }).compile();

        service = module.get<RangoshorariosService>(RangoshorariosService);
    });

    it('deber�a crear un rango horario', async () => {
        const dto = {
            nombre: 'Turno Ma�ana',
            usuarioCarga: 'admin',
            fechaDeAlta: new Date('2024-04-01'),


        };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toEqual(mockRango);
    });

    it('deber�a obtener todos los rangos horarios', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([mockRango]);
    });

    it('deber�a obtener un rango horario por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(mockRango);
    });

    it('deber�a lanzar NotFoundException si no existe el rango', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('deber�a actualizar un rango horario', async () => {
        const dto = { nombre: 'Turno Modificado' };
        modelMock.findByPk.mockResolvedValue(mockRango);
        const result = await service.actualizar(1, dto);
        expect(mockRango.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('deber�a eliminar un rango horario correctamente', async () => {
        modelMock.findByPk.mockResolvedValue(mockRango);
        const result = await service.eliminar(1);
        expect(mockRango.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
