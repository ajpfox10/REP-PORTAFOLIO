import '../../test/utils/test-setup'; // ✅ Mocks globales de guards y JwtService

import { Test, TestingModule } from '@nestjs/testing';
import { SectorController } from './sector.controller';
import { SectorService } from './sector.service';
import { CrearSectorDto } from './dto/crear-sector.dto';
import { ActualizarSectorDto } from './dto/actualizar-sector.dto';

describe('SectorController', () => {
    let controller: SectorController;
    let service: SectorService;

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
            controllers: [SectorController],
            providers: [{ provide: SectorService, useValue: mockService }],
        }).compile();

        controller = module.get<SectorController>(SectorController);
        service = module.get<SectorService>(SectorService);
    });

    it('debería crear un sector', async () => {
        const dto: CrearSectorDto = {
            nombre: 'Informática',
            usuarioCarga: 'admin',
        };

        const resultadoEsperado = { id: 1, ...dto };
        mockService.crear.mockResolvedValue(resultadoEsperado);

        const result = await controller.crear(dto);
        expect(result).toEqual(resultadoEsperado);
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todos los sectores', async () => {
        const resultadoEsperado = [{ id: 1, nombre: 'Informática' }];
        mockService.obtenerTodos.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerTodos();
        expect(result).toEqual(resultadoEsperado);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener un sector por ID', async () => {
        const resultadoEsperado = { id: 1, nombre: 'Informática' };
        mockService.obtenerPorId.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(resultadoEsperado);
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar un sector', async () => {
        const dto: ActualizarSectorDto = { nombre: 'Actualizado' };
        const resultadoEsperado = { id: 1, ...dto };

        mockService.actualizar.mockResolvedValue(resultadoEsperado);

        const result = await controller.actualizar(1, dto);
        expect(result).toEqual(resultadoEsperado);
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar un sector', async () => {
        mockService.eliminar.mockResolvedValue(undefined);

        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});
