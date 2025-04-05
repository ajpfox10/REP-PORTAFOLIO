// Test unitario para ministerios.controller
import { Test, TestingModule } from '@nestjs/testing';
import { MinisteriosController } from './ministerios.controller';
import { MinisteriosService } from './ministerios.service';
import { CrearMinisteriosDto } from './dto/crear-ministerios.dto';
import { ActualizarMinisteriosDto } from './dto/actualizar-ministerios.dto';

describe('MinisteriosController', () => {
    let controller: MinisteriosController;
    let service: MinisteriosService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Ministerio de Salud' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Ministerio de Salud' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [MinisteriosController],
            providers: [{ provide: MinisteriosService, useValue: mockService }],
        }).compile();

        controller = module.get<MinisteriosController>(MinisteriosController);
        service = module.get<MinisteriosService>(MinisteriosService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el ministerio creado', () => {
        const dto: CrearMinisteriosDto = {
            nombre: 'Ministerio de Salud',
            fechaDeAlta: new Date('2024-03-31'),
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todos los ministerios', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Ministerio de Salud' }]);
    });

    it('obtenerPorId() debe retornar un ministerio específico', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Ministerio de Salud' });
    });

    it('actualizar() debe retornar el ministerio actualizado', () => {
        const dto: ActualizarMinisteriosDto = {
            nombre: 'Ministerio de Educación',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar la eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
