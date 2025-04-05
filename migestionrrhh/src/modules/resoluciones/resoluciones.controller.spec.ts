// Test unitario para resoluciones.controller
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

    it('crear() debe retornar la resolución creada', () => {
        const dto: CrearResolucionDto = {
            resolucion: 'Resolución 123',
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodas() debe retornar todas las resoluciones', () => {
        expect(controller.obtenerTodas()).toEqual([
            { id: 1, resolucion: 'Resolución 123', usuarioCarga: 'admin' },
        ]);
    });

    it('actualizar() debe modificar una resolución', () => {
        const dto: ActualizarResolucionDto = {
            resolucion: 'Resolución 123 modificada',
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar la eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
