import '../../test/utils/test-setup'; // ✅ Mocks globales activos

import { Test, TestingModule } from '@nestjs/testing';
import { MinisteriosController } from './ministerios.controller';
import { MinisteriosService } from './ministerios.service';

describe('MinisteriosController', () => {
    let controller: MinisteriosController;
    let service: MinisteriosService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Salud', usuarioCarga: 'admin' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Salud' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(() => undefined),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            controllers: [MinisteriosController],
            providers: [
                {
                    provide: MinisteriosService,
                    useValue: mockService,
                },
            ],
        }).compile();

        controller = module.get<MinisteriosController>(MinisteriosController);
        service = module.get<MinisteriosService>(MinisteriosService);
    });

    it('debería crear un ministerio', async () => {
        const dto = {
            nombre: 'Salud',
            usuarioCarga: 'admin',
            fechaDeAlta: new Date(),
        };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todos', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toHaveLength(1);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result.id).toBe(1);
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar', async () => {
        const dto = { nombre: 'Modificado' };
        const result = await controller.actualizar(1, dto);
        expect(result.nombre).toBe('Modificado');
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar', async () => {
        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});
