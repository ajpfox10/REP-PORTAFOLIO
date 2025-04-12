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
        nombre: 'R�gimen Semanal',
        usuarioCarga: 'admin',
        fechaDeAlta: new Date(),
        update: jest.fn().mockResolvedValue({ id: 1, nombre: 'R�gimen Actualizado', usuarioCarga: 'admin' }),
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

    it('deber�a crear y retornar un r�gimen horario', async () => {
        const dto = {
            nombre: 'R�gimen Semanal',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toEqual(regimenMock);
    });

    it('deber�a obtener todos los reg�menes horarios', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([regimenMock]);
    });

    it('deber�a obtener un r�gimen horario por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(regimenMock);
    });

    it('deber�a lanzar NotFoundException si el r�gimen no existe', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('deber�a modificar un r�gimen horario existente', async () => {
        const updateDto = { nombre: 'R�gimen Actualizado' };
        modelMock.findByPk.mockResolvedValue(regimenMock);
        const result = await service.actualizar(1, updateDto);
        expect(regimenMock.update).toHaveBeenCalledWith(updateDto);
        expect(result).toMatchObject({ id: 1, ...updateDto });
    });

    it('deber�a eliminar un r�gimen horario correctamente', async () => {
        modelMock.findByPk.mockResolvedValue(regimenMock);
        const result = await service.eliminar(1);
        expect(regimenMock.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
