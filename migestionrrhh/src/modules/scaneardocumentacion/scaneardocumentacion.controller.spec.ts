// Test unitario para scaneardocumentacion.controller
import { Test, TestingModule } from '@nestjs/testing';
import { ScaneardocumentacionController } from './scaneardocumentacion.controller';
import { ScaneardocumentacionService } from './scaneardocumentacion.service';
import { CrearScaneardocumentacionDto } from './dto/crear-scaneardocumentacion.dto';
import { ActualizarScaneardocumentacionDto } from './dto/actualizar-scaneardocumentacion.dto';

describe('ScaneardocumentacionController', () => {
    let controller: ScaneardocumentacionController;
    let service: ScaneardocumentacionService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, descripcion: 'Doc prueba', path: '/test.pdf' }]),
        obtenerPorId: jest.fn(id => ({ id, descripcion: 'Doc prueba', path: '/test.pdf' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ScaneardocumentacionController],
            providers: [{ provide: ScaneardocumentacionService, useValue: mockService }],
        }).compile();

        controller = module.get<ScaneardocumentacionController>(ScaneardocumentacionController);
        service = module.get<ScaneardocumentacionService>(ScaneardocumentacionService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el documento creado', () => {
        const dto: CrearScaneardocumentacionDto = {
            descripcion: 'Documento prueba',
            path: '/test.pdf',
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los documentos', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, descripcion: 'Doc prueba', path: '/test.pdf' }]);
    });

    it('obtenerPorId() debe retornar un documento específico', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, descripcion: 'Doc prueba', path: '/test.pdf' });
    });

    it('actualizar() debe modificar un documento', () => {
        const dto: ActualizarScaneardocumentacionDto = {
            descripcion: 'Documento actualizado',
            path: '/updated.pdf',
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
