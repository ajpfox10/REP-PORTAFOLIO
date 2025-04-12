import '../../test/utils/test-setup'; // ✅ Mocks globales activos

import { Test, TestingModule } from '@nestjs/testing';
import { OrdenesdetrabajoController } from './ordenesdetrabajo.controller';
import { OrdenesdetrabajoService } from './ordenesdetrabajo.service';
import { CrearOrdenesdetrabajoDto } from './dto/crear-ordenesdetrabajo.dto';
import { ActualizarOrdenesdetrabajoDto } from './dto/actualizar-ordenesdetrabajo.dto';

describe('OrdenesdetrabajoController', () => {
    let controller: OrdenesdetrabajoController;
    let service: OrdenesdetrabajoService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Orden 1' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Orden 1' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [OrdenesdetrabajoController],
            providers: [{ provide: OrdenesdetrabajoService, useValue: mockService }],
        }).compile();

        controller = module.get<OrdenesdetrabajoController>(OrdenesdetrabajoController);
        service = module.get<OrdenesdetrabajoService>(OrdenesdetrabajoService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar la orden creada', async () => {
        const dto: CrearOrdenesdetrabajoDto = {
            nombre: 'Reparación de PC',
            descripcion: 'Cambio de disco rígido',
            usuarioCarga: 'admin',
            fechaDeAlta: new Date('2024-04-01'),
        };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todas las órdenes', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Orden 1' }]);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('obtenerPorId() debe retornar una orden por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Orden 1' });
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('actualizar() debe retornar la orden actualizada', async () => {
        const dto: ActualizarOrdenesdetrabajoDto = {
            nombre: 'Revisión de servidor',
            descripcion: 'Inspección y limpieza',
            usuarioCarga: 'tecnico',
            fechaDeAlta: new Date('2024-04-05'),
        };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('eliminar() debe retornar confirmación de borrado', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ deleted: true });
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});
