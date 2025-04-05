// Test unitario para reparticiones.controller
import { Test, TestingModule } from '@nestjs/testing';
import { ReparticionesController } from './reparticiones.controller';
import { ReparticionesService } from './reparticiones.service';
import { ActualizarReparticionesDto } from './dto/actualizar-reparticiones.dto';

describe('ReparticionesController', () => {
    let controller: ReparticionesController;
    let service: ReparticionesService;

    const mockService = {
        obtenerTodos: jest.fn(() => [{ id: 1, descripcion: 'Direcci�n de RRHH' }]),
        obtenerPorId: jest.fn(id => ({ id, descripcion: 'Direcci�n de RRHH' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ReparticionesController],
            providers: [{ provide: ReparticionesService, useValue: mockService }],
        }).compile();

        controller = module.get<ReparticionesController>(ReparticionesController);
        service = module.get<ReparticionesService>(ReparticionesService);
    });

    it('deber�a estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('obtenerTodos() debe retornar todas las reparticiones', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, descripcion: 'Direcci�n de RRHH' }]);
    });

    it('obtenerPorId() debe retornar una repartici�n espec�fica', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, descripcion: 'Direcci�n de RRHH' });
    });

    it('actualizar() debe modificar una repartici�n', () => {
        const dto: ActualizarReparticionesDto = {
            nombre: 'Nueva Repartici�n',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar borrado', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
