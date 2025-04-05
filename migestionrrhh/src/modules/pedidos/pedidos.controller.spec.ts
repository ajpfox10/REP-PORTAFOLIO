// Test unitario para pedidos.controller
import { Test, TestingModule } from '@nestjs/testing';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';
import { CrearPedidosDto } from './dto/crear-pedidos.dto';
import { ActualizarPedidosDto } from './dto/actualizar-pedidos.dto';

describe('PedidosController', () => {
    let controller: PedidosController;
    let service: PedidosService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Pedido 1' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Pedido 1' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PedidosController],
            providers: [{ provide: PedidosService, useValue: mockService }],
        }).compile();

        controller = module.get<PedidosController>(PedidosController);
        service = module.get<PedidosService>(PedidosService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el pedido creado', () => {
        const dto: CrearPedidosDto = {
            nombre: 'Pedido de papelería',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los pedidos', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Pedido 1' }]);
    });

    it('obtenerPorId() debe retornar un pedido por ID', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Pedido 1' });
    });

    it('actualizar() debe retornar el pedido actualizado', () => {
        const dto: ActualizarPedidosDto = {
            nombre: 'Pedido actualizado',
            fechaDeAlta: new Date('2024-04-03'),
            usuarioCarga: 'admin',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar la eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
