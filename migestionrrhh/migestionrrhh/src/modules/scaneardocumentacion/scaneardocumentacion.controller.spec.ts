import '../../test/utils/test-setup'; // ✅ Mocks globales de guards y JwtService

import { Test, TestingModule } from '@nestjs/testing';
import { ScaneardocumentacionController } from './scaneardocumentacion.controller';
import { ScaneardocumentacionService } from './scaneardocumentacion.service';
import { CrearScaneardocumentacionDto } from './dto/crear-scaneardocumentacion.dto';
import { ActualizarScaneardocumentacionDto } from './dto/actualizar-scaneardocumentacion.dto';

describe('ScaneardocumentacionController', () => {
    let controller: ScaneardocumentacionController;
    let service: ScaneardocumentacionService;

    const mockService = {
        crear: jest.fn(),
        obtenerPorId: jest.fn(),
        actualizar: jest.fn(),
        eliminar: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ScaneardocumentacionController],
            providers: [{ provide: ScaneardocumentacionService, useValue: mockService }],
        }).compile();

        controller = module.get<ScaneardocumentacionController>(ScaneardocumentacionController);
        service = module.get<ScaneardocumentacionService>(ScaneardocumentacionService);
    });

    it('debería crear un documento escaneado', async () => {
        const dto: CrearScaneardocumentacionDto = {
            descripcion: 'Documento de prueba',
            path: '/documentos/test.pdf',
            usuarioCarga: 'admin',
        };

        const esperado = { id: 1, ...dto };
        mockService.crear.mockResolvedValue(esperado);

        const result = await controller.crear(dto);
        expect(result).toEqual(esperado);
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener un documento por id', async () => {
        const esperado = {
            id: 1,
            descripcion: 'Documento de prueba',
            path: '/documentos/test.pdf',
            usuarioCarga: 'admin',
        };

        mockService.obtenerPorId.mockResolvedValue(esperado);

        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(esperado);
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar un documento escaneado', async () => {
        const dto: ActualizarScaneardocumentacionDto = {
            descripcion: 'Modificado',
        };

        const esperado = {
            id: 1,
            descripcion: 'Modificado',
            path: '/documentos/test.pdf',
            usuarioCarga: 'admin',
        };

        mockService.actualizar.mockResolvedValue(esperado);

        const result = await controller.actualizar(1, dto);
        expect(result).toEqual(esperado);
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar un documento', async () => {
        mockService.eliminar.mockResolvedValue(undefined);
        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});
