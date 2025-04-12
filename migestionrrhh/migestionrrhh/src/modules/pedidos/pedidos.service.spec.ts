import { Test, TestingModule } from '@nestjs/testing';
import { PedidosService } from './pedidos.service';
import { Pedidos } from './pedidos.model';
import { getModelToken } from '@nestjs/sequelize';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';

describe('PedidosService', () => {
    let service: PedidosService;
    let modelMock: any;

    const pedidoMock = {
        id: 1,
        nombre: 'Pedido 1',
        usuarioCarga: 'admin',
        fechaDeAlta: new Date(),
        update: jest.fn().mockResolvedValue({
            id: 1,
            nombre: 'Pedido Actualizado',
            usuarioCarga: 'admin',
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        modelMock = {
            create: jest.fn().mockResolvedValue(pedidoMock),
            findAll: jest.fn().mockResolvedValue([pedidoMock]),
            findByPk: jest.fn().mockResolvedValue(pedidoMock),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PedidosService,
                { provide: getModelToken(Pedidos), useValue: modelMock },
            ],
        }).compile();

        service = module.get<PedidosService>(PedidosService);
    });

    it('debería crear un pedido', async () => {
        const dto = {
            nombre: 'Pedido 1',
            usuarioCarga: 'admin',
            fechaDeAlta: new Date(), // ✅ ahora incluido
        };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toEqual(pedidoMock);
    });

    it('debería obtener todos los pedidos', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([pedidoMock]);
    });

    it('debería obtener un pedido por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(pedidoMock);
    });

    it('debería lanzar NotFoundException si el pedido no existe', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('debería modificar un pedido existente', async () => {
        const updateDto = { nombre: 'Pedido Actualizado' };
        modelMock.findByPk.mockResolvedValue(pedidoMock);
        const result = await service.actualizar(1, updateDto);
        expect(pedidoMock.update).toHaveBeenCalledWith(updateDto);
        expect(result).toMatchObject({ id: 1, ...updateDto });
    });

    it('debería eliminar un pedido correctamente', async () => {
        modelMock.findByPk.mockResolvedValue(pedidoMock);
        const result = await service.eliminar(1);
        expect(pedidoMock.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
