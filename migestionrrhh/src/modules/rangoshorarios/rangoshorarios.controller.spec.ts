// Test unitario para rangoshorarios.controller
import { Test, TestingModule } from '@nestjs/testing';
import { RangoshorariosController } from './rangoshorarios.controller';
import { RangoshorariosService } from './rangoshorarios.service';
import { CrearRangoshorariosDto } from './dto/crear-rangoshorarios.dto';
import { ActualizarRangoshorariosDto } from './dto/actualizar-rangoshorarios.dto';

describe('RangoshorariosController', () => {
    let controller: RangoshorariosController;
    let service: RangoshorariosService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Turno Mañana' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Turno Mañana' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [RangoshorariosController],
            providers: [{ provide: RangoshorariosService, useValue: mockService }],
        }).compile();

        controller = module.get<RangoshorariosController>(RangoshorariosController);
        service = module.get<RangoshorariosService>(RangoshorariosService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el rango horario creado', () => {
        const dto: CrearRangoshorariosDto = {
            nombre: 'Turno Mañana',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todos los rangos horarios', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Turno Mañana' }]);
    });

    it('obtenerPorId() debe retornar un rango horario específico', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Turno Mañana' });
    });

    it('actualizar() debe retornar el rango actualizado', () => {
        const dto: ActualizarRangoshorariosDto = {
            nombre: 'Turno Tarde',
            fechaDeAlta: new Date('2024-04-02'),
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
