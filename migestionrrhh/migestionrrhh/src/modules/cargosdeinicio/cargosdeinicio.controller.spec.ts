import '../../test/utils/test-setup'; // ✅ Mock global de guards y JwtService

import { Test, TestingModule } from '@nestjs/testing';
import { CargosdeinicioController } from './cargosdeinicio.controller';
import { CargosdeinicioService } from './cargosdeinicio.service';
import { CrearCargosDeInicioDto } from './dto/cargosdeinicio.dto';
import { ActualizarCargosDeInicioDto } from './dto/actualizar-cargosdeinicio.dto';

describe('CargosdeinicioController', () => {
    let controller: CargosdeinicioController;
    let service: CargosdeinicioService;

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
            controllers: [CargosdeinicioController],
            providers: [
                { provide: CargosdeinicioService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<CargosdeinicioController>(CargosdeinicioController);
        service = module.get<CargosdeinicioService>(CargosdeinicioService);
    });

    it('debería crear un cargo de inicio', async () => {
        const dto: CrearCargosDeInicioDto = {
            cargo: 'Test',
            descripcion: 'Descripción',
            fechaDeAlta: new Date('2024-01-01'),
            usuarioCarga: 'admin',
        };

        const resultadoEsperado = { id: 1, ...dto };
        mockService.crear.mockResolvedValue(resultadoEsperado);

        expect(await controller.crear(dto)).toEqual(resultadoEsperado);
        expect(mockService.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todos los cargos de inicio', async () => {
        const resultadoEsperado = [{
            id: 1,
            cargo: 'Test',
            descripcion: 'Descripción',
            fechaDeAlta: new Date('2024-01-01'),
            usuarioCarga: 'admin',
        }];

        mockService.obtenerTodos.mockResolvedValue(resultadoEsperado);

        expect(await controller.obtenerTodos()).toEqual(resultadoEsperado);
        expect(mockService.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener un cargo por id', async () => {
        const resultadoEsperado = {
            id: 1,
            cargo: 'Test',
            descripcion: 'Descripción',
            fechaDeAlta: new Date('2024-01-01'),
            usuarioCarga: 'admin',
        };

        mockService.obtenerPorId.mockResolvedValue(resultadoEsperado);

        expect(await controller.obtenerPorId(1)).toEqual(resultadoEsperado);
        expect(mockService.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar un cargo', async () => {
        const id = 1;
        const dto: ActualizarCargosDeInicioDto = {
            cargo: 'Actualizado',
            descripcion: 'Actualizada',
        };

        const resultadoEsperado = {
            id,
            ...dto,
            fechaDeAlta: new Date('2024-01-01'),
            usuarioCarga: 'admin',
        };

        mockService.actualizar.mockResolvedValue(resultadoEsperado);

        expect(await controller.actualizar(id, dto)).toEqual(resultadoEsperado);
        expect(mockService.actualizar).toHaveBeenCalledWith(id, dto);
    });

    it('debería eliminar un cargo', async () => {
        const id = 1;
        mockService.eliminar.mockResolvedValue(undefined);

        const result = await controller.eliminar(id);
        expect(result).toBeUndefined();
        expect(mockService.eliminar).toHaveBeenCalledWith(id);
    });
});
