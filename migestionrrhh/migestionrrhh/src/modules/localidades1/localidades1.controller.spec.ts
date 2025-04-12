import '../../test/utils/test-setup'; // ✅ Mocks globales de guards y JWT

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
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Localidad X', usuarioCarga: 'admin' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Localidad X', usuarioCarga: 'admin' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(() => undefined),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            controllers: [Localidades1Controller],
            providers: [
                { provide: Localidades1Service, useValue: mockService },
            ],
        }).compile();

        controller = module.get<Localidades1Controller>(Localidades1Controller);
        service = module.get<Localidades1Service>(Localidades1Service);
    });

    it('debería crear una localidad', async () => {
        const dto: CrearLocalidades1Dto = {
            nombre: 'Localidad A',
            usuarioCarga: 'admin',
        };

        const result = await controller.crear(dto);
        expect(result).toEqual(expect.objectContaining(dto));
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todas las localidades', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toHaveLength(1);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener una localidad por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(expect.objectContaining({ id: 1 }));
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar una localidad', async () => {
        const dto: ActualizarLocalidades1Dto = { nombre: 'Modificado' };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual(expect.objectContaining({ nombre: 'Modificado' }));
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar una localidad', async () => {
        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});
