import { Test, TestingModule } from '@nestjs/testing';
import { LeyesController } from './leyes.controller';
import { LeyesService } from './leyes.service';
import { CrearLeyDto } from './dto/crear-ley.dto';
import { ActualizarLeyDto } from './dto/actualizar-ley.dto';

describe('LeyesController', () => {
    let controller: LeyesController;
    let service: LeyesService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, Ley: 'Ley A' }]),
        obtenerPorId: jest.fn(id => ({ id, Ley: 'Ley A' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [LeyesController],
            providers: [{ provide: LeyesService, useValue: mockService }],
        }).compile();

        controller = module.get<LeyesController>(LeyesController);
        service = module.get<LeyesService>(LeyesService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar la ley creada', () => {
        const dto: CrearLeyDto = {
            Ley: 'Ley de Protección de Datos',
            codigoleyes: 1001,
            leyactiva: 1,
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todas las leyes', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, Ley: 'Ley A' }]);
    });

    it('obtenerPorId() debe retornar una ley específica', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, Ley: 'Ley A' });
    });

    it('actualizar() debe retornar la ley modificada', () => {
        const dto: ActualizarLeyDto = {
            Ley: 'Ley modificada',
            codigoleyes: 2002,
            leyactiva: 1,
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
