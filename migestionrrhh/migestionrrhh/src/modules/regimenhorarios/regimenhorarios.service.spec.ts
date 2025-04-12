import { Test, TestingModule } from '@nestjs/testing';
import { RegimenhorariosService } from './regimenhorarios.service';
import { Regimenhorarios } from './regimenhorarios.model';
import { getModelToken } from '@nestjs/sequelize';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';

describe('RegimenhorariosService', () => {
    let service: RegimenhorariosService;
    let modelMock: any;

    const regimenMock = {
        id: 1,
        nombre: 'Régimen Semanal',
        usuarioCarga: 'admin',
        fechaDeAlta: new Date(),
        update: jest.fn().mockResolvedValue({ id: 1, nombre: 'Régimen Actualizado', usuarioCarga: 'admin' }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        modelMock = {
            create: jest.fn().mockResolvedValue(regimenMock),
            findAll: jest.fn().mockResolvedValue([regimenMock]),
            findByPk: jest.fn().mockResolvedValue(regimenMock),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RegimenhorariosService,
                { provide: getModelToken(Regimenhorarios), useValue: modelMock },
            ],
        }).compile();

        service = module.get<RegimenhorariosService>(RegimenhorariosService);
    });

    it('debería crear y retornar un régimen horario', async () => {
        const dto = {
            nombre: 'Régimen Semanal',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toEqual(regimenMock);
    });

    it('debería obtener todos los regímenes horarios', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([regimenMock]);
    });

    it('debería obtener un régimen horario por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(regimenMock);
    });

    it('debería lanzar NotFoundException si el régimen no existe', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('debería modificar un régimen horario existente', async () => {
        const updateDto = { nombre: 'Régimen Actualizado' };
        modelMock.findByPk.mockResolvedValue(regimenMock);
        const result = await service.actualizar(1, updateDto);
        expect(regimenMock.update).toHaveBeenCalledWith(updateDto);
        expect(result).toMatchObject({ id: 1, ...updateDto });
    });

    it('debería eliminar un régimen horario correctamente', async () => {
        modelMock.findByPk.mockResolvedValue(regimenMock);
        const result = await service.eliminar(1);
        expect(regimenMock.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
