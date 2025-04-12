import '../../test/utils/test-setup'; // ✅ mocks globales de guards

import { Test, TestingModule } from '@nestjs/testing';
import { LeyesController } from './leyes.controller';
import { LeyesService } from './leyes.service';
import { CrearLeyDto } from './dto/crear-ley.dto';
import { ActualizarLeyDto } from './dto/actualizar-ley.dto';

describe('LeyesController', () => {
    let controller: LeyesController;
    let service: LeyesService;

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
            controllers: [LeyesController],
            providers: [
                { provide: LeyesService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<LeyesController>(LeyesController);
        service = module.get<LeyesService>(LeyesService);
    });

    it('debería crear una ley', async () => {
        const dto: CrearLeyDto = {
            Ley: 'Ley de Presupuesto',
            codigoleyes: 1001,
            leyactiva: 1,
            usuarioCarga: 'admin',
        };

        const resultadoEsperado = { id: 1, ...dto };
        mockService.crear.mockResolvedValue(resultadoEsperado);

        const result = await controller.crear(dto);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todas las leyes', async () => {
        const resultadoEsperado = [
            { id: 1, usuarioCarga: 'admin' },
        ];

        mockService.obtenerTodos.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerTodos();
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener una ley por id', async () => {
        const resultadoEsperado = {
            id: 1,
            usuarioCarga: 'admin',
        };

        mockService.obtenerPorId.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar una ley', async () => {
        const id = 1;
        const dto: ActualizarLeyDto = {
            usuarioCarga: 'admin',
        };

        const resultadoEsperado = {
            id,
            ...dto,
        };

        mockService.actualizar.mockResolvedValue(resultadoEsperado);

        const result = await controller.actualizar(id, dto);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.actualizar).toHaveBeenCalledWith(id, dto);
    });

    it('debería eliminar una ley', async () => {
        const id = 1;
        mockService.eliminar.mockResolvedValue(undefined);

        const result = await controller.eliminar(id);
        expect(result).toBeUndefined();
        expect(mockService.eliminar).toHaveBeenCalledWith(id);
    });
});
