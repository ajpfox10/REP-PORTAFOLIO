import { Test, TestingModule } from '@nestjs/testing';
import { OrdenesdetrabajoService } from './ordenesdetrabajo.service';
import { NotFoundException } from '@nestjs/common';
import { Ordenesdetrabajo } from './ordenesdetrabajo.model';
import { getModelToken } from '@nestjs/sequelize';

describe('OrdenesdetrabajoService', () => {
    let service: OrdenesdetrabajoService;
    const ordenMock = {
        update: jest.fn(),
        destroy: jest.fn(),
    };
    const modelMock = {
        findAll: jest.fn().mockResolvedValue([ordenMock]),
        findByPk: jest.fn().mockResolvedValue(ordenMock),
    };
    const mockLogger = { log: jest.fn(), error: jest.fn() };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrdenesdetrabajoService,
                { provide: getModelToken(Ordenesdetrabajo), useValue: modelMock },
                { provide: 'Logger', useValue: mockLogger },
            ],
        }).compile();

        service = module.get<OrdenesdetrabajoService>(OrdenesdetrabajoService);
    });

    it('deber�a actualizar la orden correctamente', async () => {
        const dto = {
            nombre: 'Reparaci�n de PC',
            descripcion: 'Cambio de disco r�gido',
            usuarioCarga: 'admin',
        };

        ordenMock.update.mockResolvedValue({ id: 1, ...dto });
        modelMock.findByPk.mockResolvedValue(ordenMock);

        const result = await service.actualizar(1, dto);
        expect(ordenMock.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('deber�a obtener todas las �rdenes', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([ordenMock]);
    });

    it('deber�a obtener una orden por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(ordenMock);
    });

    it('deber�a lanzar NotFoundException si no se encuentra la orden', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('deber�a eliminar la orden correctamente', async () => {
        modelMock.findByPk.mockResolvedValue(ordenMock);
        const result = await service.eliminar(1);
        expect(ordenMock.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
