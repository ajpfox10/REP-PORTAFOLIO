import '../../test/utils/test-setup'; // ✅ Mocks globales de guards y JwtService

import { Test, TestingModule } from '@nestjs/testing';
import { PlantaController } from './planta.controller';
import { PlantaService } from './planta.service';

describe('PlantaController', () => {
    let controller: PlantaController;
    let service: PlantaService;

    const mockService = {
        crear: jest.fn(),
        obtenerTodos: jest.fn(),
        obtenerPorId: jest.fn(),
        actualizar: jest.fn(),
        eliminar: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [PlantaController],
            providers: [
                { provide: PlantaService, useValue: mockService }, // ✅ solo mock
            ],
        }).compile();

        controller = module.get<PlantaController>(PlantaController);
        service = module.get<PlantaService>(PlantaService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar la planta creada', async () => {
        const dto = {
            nombre: 'Planta Central',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        const esperado = { id: 1, ...dto };
        mockService.crear.mockResolvedValue(esperado);

        const result = await controller.crear(dto);
        expect(result).toEqual(esperado);
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todas las plantas', async () => {
        const esperado = [{ id: 1, nombre: 'Planta A' }];
        mockService.obtenerTodos.mockResolvedValue(esperado);

        const result = await controller.obtenerTodos();
        expect(result).toEqual(esperado);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('obtenerPorId() debe retornar una planta específica', async () => {
        const esperado = { id: 1, nombre: 'Planta A' };
        mockService.obtenerPorId.mockResolvedValue(esperado);

        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(esperado);
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('actualizar() debe retornar la planta modificada', async () => {
        const dto = {
            nombre: 'Planta Modificada',
            fechaDeAlta: new Date('2024-04-02'),
            usuarioCarga: 'editor',
        };
        const esperado = { id: 1, ...dto };
        mockService.actualizar.mockResolvedValue(esperado);

        const result = await controller.actualizar(1, dto);
        expect(result).toEqual(esperado);
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('eliminar() debe ejecutar la eliminación sin errores', async () => {
        mockService.eliminar.mockResolvedValue(undefined);

        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});

