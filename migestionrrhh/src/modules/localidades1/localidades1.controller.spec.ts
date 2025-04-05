// Test unitario para localidades1.controller
import { Test, TestingModule } from '@nestjs/testing';
import { Localidades1Controller } from './localidades1.controller';
import { Localidades1Service } from './localidades1.service';
import { CrearLocalidades1Dto } from './dto/crear-localidades1.dto';
import { ActualizarLocalidades1Dto } from './dto/actualizar_localidades1.dto';

describe('Localidades1Controller', () => {
    let controller: Localidades1Controller;
    let service: Localidades1Service;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Localidad A' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Localidad A' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [Localidades1Controller],
            providers: [{ provide: Localidades1Service, useValue: mockService }],
        }).compile();

        controller = module.get<Localidades1Controller>(Localidades1Controller);
        service = module.get<Localidades1Service>(Localidades1Service);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar la localidad creada', () => {
        const dto: CrearLocalidades1Dto = {
            nombre: 'Localidad Nueva',
            usuarioCarga: 'admin',
            descripcion: 'Una ciudad costera',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todas las localidades', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Localidad A' }]);
    });

    it('obtenerPorId() debe retornar una localidad específica', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Localidad A' });
    });

    it('actualizar() debe retornar la localidad actualizada', () => {
        const dto: ActualizarLocalidades1Dto = {
            nombre: 'Localidad Nueva',
            usuarioCarga: 'admin',
            descripcion: 'Una ciudad costera',

        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
