import { Test, TestingModule } from '@nestjs/testing';
import { CedulaController } from './cedula.controller';
import { CedulaService } from './cedula.service';
import { CrearCedulaDto } from './dto/cedula.dto';
import { ActualizarCedulaDto } from './dto/actualizar-cedula.dto';

describe('CedulaController', () => {
    let controller: CedulaController;
    let service: CedulaService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, numero: '123', titular: 'Juan P�rez', usuarioCarga: 'admin' }]),
        obtenerPorId: jest.fn(id => ({ id, numero: '123', titular: 'Juan P�rez', usuarioCarga: 'admin' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CedulaController],
            providers: [{ provide: CedulaService, useValue: mockService }],
        }).compile();

        controller = module.get<CedulaController>(CedulaController);
        service = module.get<CedulaService>(CedulaService);
    });

    it('deber�a estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el objeto creado', () => {
        const dto: CrearCedulaDto = {
            numero: '123',
            fechaEmision: new Date('2024-03-31'),
            titular: 'Juan P�rez',
            domicilio: 'Direcci�n X',
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar lista de objetos', () => {
        expect(controller.obtenerTodos()).toEqual([
            { id: 1, numero: '123', titular: 'Juan P�rez', usuarioCarga: 'admin' },
        ]);
    });

    it('obtenerPorId() debe retornar un objeto por ID', () => {
        expect(controller.obtenerPorId(1)).toEqual({
            id: 1,
            numero: '123',
            titular: 'Juan P�rez',
            usuarioCarga: 'admin',
        });
    });

    it('actualizar() debe retornar el objeto actualizado', () => {
        const dto: ActualizarCedulaDto = {
            numero: '456',
            fechaEmision: new Date('2024-04-01'),
            titular: 'Maria L�pez',
            usuarioCarga: 'admin',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe retornar confirmaci�n de borrado', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
