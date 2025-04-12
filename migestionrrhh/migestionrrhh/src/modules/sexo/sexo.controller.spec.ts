import '../../test/utils/test-setup'; // ✅ Mocks globales activos

import { Test, TestingModule } from '@nestjs/testing';
import { SexoController } from './sexo.controller';
import { SexoService } from './sexo.service';

describe('SexoController', () => {
    let controller: SexoController;
    let service: SexoService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, descripcion: 'Masculino' }]),
        obtenerPorId: jest.fn(id => ({ id, descripcion: 'Masculino' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(() => undefined),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SexoController],
            providers: [
                {
                    provide: SexoService,
                    useValue: mockService,
                },
            ],
        }).compile();

        controller = module.get<SexoController>(SexoController);
        service = module.get<SexoService>(SexoService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });


    it('debería obtener todos los sexos', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toHaveLength(1);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener uno por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result.id).toBe(1);
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar', async () => {
        const dto = { descripcion: 'Otro' };
        const result = await controller.actualizar(1, dto as any);
        expect(result.descripcion).toBe('Otro');
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar', async () => {
        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});

