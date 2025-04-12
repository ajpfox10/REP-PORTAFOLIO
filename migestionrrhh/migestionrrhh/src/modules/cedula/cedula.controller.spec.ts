import '../../test/utils/test-setup'; // ✅ mocks globales activados

import { Test, TestingModule } from '@nestjs/testing';
import { CedulaController } from './cedula.controller';
import { CedulaService } from './cedula.service';
import { CrearCedulaDto } from './dto/cedula.dto';
import { ActualizarCedulaDto } from './dto/actualizar-cedula.dto';

describe('CedulaController', () => {
    let controller: CedulaController;
    let service: CedulaService;

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
            controllers: [CedulaController],
            providers: [
                { provide: CedulaService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<CedulaController>(CedulaController);
        service = module.get<CedulaService>(CedulaService);
    });

    it('debería crear una cédula', async () => {
        const dto: CrearCedulaDto = {
            numero: '12345678',
            fechaEmision: new Date('2023-01-01'),
            titular: 'Juan Pérez',
            usuarioCarga: 'admin',
        };

        const resultadoEsperado = { id: 1, ...dto };
        mockService.crear.mockResolvedValue(resultadoEsperado);

        const result = await controller.crear(dto);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todas las cédulas', async () => {
        const resultadoEsperado = [{
            id: 1,
            numero: '12345678',
            fechaEmision: new Date('2023-01-01'),
            titular: 'Juan Pérez',
            usuarioCarga: 'admin',
        }];

        mockService.obtenerTodos.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerTodos();
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener una cédula por id', async () => {
        const resultadoEsperado = {
            id: 1,
            numero: '12345678',
            fechaEmision: new Date('2023-01-01'),
            titular: 'Juan Pérez',
            usuarioCarga: 'admin',
        };

        mockService.obtenerPorId.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar una cédula', async () => {
        const id = 1;
        const dto: ActualizarCedulaDto = {
            numero: '87654321',
            titular: 'Juan Modificado',
        };

        const resultadoEsperado = {
            id,
            ...dto,
            fechaEmision: new Date('2023-01-01'),
            usuarioCarga: 'admin',
        };

        mockService.actualizar.mockResolvedValue(resultadoEsperado);

        const result = await controller.actualizar(id, dto);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.actualizar).toHaveBeenCalledWith(id, dto);
    });

    it('debería eliminar una cédula', async () => {
        const id = 1;
        mockService.eliminar.mockResolvedValue(undefined);

        const result = await controller.eliminar(id);
        expect(result).toBeUndefined();
        expect(mockService.eliminar).toHaveBeenCalledWith(id);
    });
});