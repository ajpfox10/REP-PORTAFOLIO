import '../../test/utils/test-setup'; // ✅ Mocks globales de guards y JwtService

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
        eliminar: jest.fn(() => ({ deleted: true })),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            controllers: [RangoshorariosController],
            providers: [
                { provide: RangoshorariosService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<RangoshorariosController>(RangoshorariosController);
        service = module.get<RangoshorariosService>(RangoshorariosService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el rango horario creado', async () => {
        const dto: CrearRangoshorariosDto = {
            nombre: 'Turno Mañana',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todos los rangos horarios', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Turno Mañana' }]);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('obtenerPorId() debe retornar un rango horario específico', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Turno Mañana' });
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('actualizar() debe retornar el rango actualizado', async () => {
        const dto: ActualizarRangoshorariosDto = {
            nombre: 'Turno Tarde',
            fechaDeAlta: new Date('2024-04-02'),
            usuarioCarga: 'editor',
        };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('eliminar() debe confirmar eliminación', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ deleted: true });
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});
