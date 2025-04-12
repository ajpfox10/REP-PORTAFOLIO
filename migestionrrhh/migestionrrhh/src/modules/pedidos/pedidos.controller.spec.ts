import '../../test/utils/test-setup'; // ✅ Mocks globales activos

import { Test, TestingModule } from '@nestjs/testing';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';

describe('PedidosController', () => {
    let controller: PedidosController;
    let service: PedidosService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [
            { id: 1, nombre: 'Pedido A', usuarioCarga: 'admin' },
        ]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Pedido A' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(() => undefined),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [PedidosController],
            providers: [
                { provide: PedidosService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<PedidosController>(PedidosController);
        service = module.get<PedidosService>(PedidosService);
    });

    it('debería crear un pedido', async () => {
        const dto = { nombre: 'Pedido A', usuarioCarga: 'admin', fechaDeAlta: new Date() };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todos los pedidos', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toHaveLength(1);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result.id).toBe(1);
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar un pedido', async () => {
        const dto = { nombre: 'Modificado' };
        const result = await controller.actualizar(1, dto);
        expect(result.nombre).toBe('Modificado');
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar un pedido', async () => {
        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});
