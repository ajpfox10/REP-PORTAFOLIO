import { Test, TestingModule } from '@nestjs/testing';
import { Ocupacion1Controller } from './ocupacion1.controller';
import { Ocupacion1Service } from './ocupacion1.service';
import { CrearOcupacion1Dto } from './dto/crear-ocupacion1.dto';
import { ActualizarOcupacion1Dto } from './dto/actualizar-ocupacion1.dto';

describe('Ocupacion1Controller', () => {
    let controller: Ocupacion1Controller;
    let service: Ocupacion1Service;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Ingeniero' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Ingeniero' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [Ocupacion1Controller],
            providers: [{ provide: Ocupacion1Service, useValue: mockService }],
        }).compile();

        controller = module.get<Ocupacion1Controller>(Ocupacion1Controller);
        service = module.get<Ocupacion1Service>(Ocupacion1Service);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar la ocupación creada', () => {
        const dto: CrearOcupacion1Dto = {
            nombre: 'Ingeniero en Sistemas',
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar lista de ocupaciones', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Ingeniero' }]);
    });

    it('obtenerPorId() debe retornar una ocupación específica', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Ingeniero' });
    });

    it('actualizar() debe retornar la ocupación actualizada', () => {
        const dto: ActualizarOcupacion1Dto = {
            nombre: 'Arquitecto de Software',
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar la eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
