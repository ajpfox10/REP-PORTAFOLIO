import '../../test/utils/test-setup'; // ✅ Mocks globales

import { Test, TestingModule } from '@nestjs/testing';
import { ResolucionesController } from './resoluciones.controller';
import { ResolucionesService } from './resoluciones.service';
import { CrearResolucionDto } from './dto/resoluciones.dto';
import { ActualizarResolucionDto } from './dto/actualizar-resolucion.dto';

describe('ResolucionesController', () => {
    let controller: ResolucionesController;
    let service: ResolucionesService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodas: jest.fn(() => [{ id: 1, resolucion: 'Resolución 123', usuarioCarga: 'admin' }]),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ResolucionesController],
            providers: [{ provide: ResolucionesService, useValue: mockService }],
        }).compile();

        controller = module.get<ResolucionesController>(ResolucionesController);
        service = module.get<ResolucionesService>(ResolucionesService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar la resolución creada', async () => {
        const dto: CrearResolucionDto = {
            resolucion: 'Resolución 123',
            usuarioCarga: 'admin',
        };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodas() debe retornar todas las resoluciones', async () => {
        const result = await controller.obtenerTodas();
        expect(result).toEqual([
            { id: 1, resolucion: 'Resolución 123', usuarioCarga: 'admin' },
        ]);
        expect(service.obtenerTodas).toHaveBeenCalled();
    });

    it('actualizar() debe modificar una resolución', async () => {
        const dto: ActualizarResolucionDto = {
            resolucion: 'Resolución 123 modificada',
            usuarioCarga: 'editor',
        };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('eliminar() debe confirmar la eliminación', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ deleted: true });
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});

