// Test unitario para nomendador.controller
import { Test, TestingModule } from '@nestjs/testing';
import { NomendadorController } from './nomendador.controller';
import { NomendadorService } from './nomendador.service';
import { CrearNomendadorDto } from './dto/crear-nomendador.dto';
import { ActualizarNomendadorDto } from './dto/actualizar-nomendador.dto';

describe('NomendadorController', () => {
    let controller: NomendadorController;
    let service: NomendadorService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Dirección General A' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Dirección General A' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [NomendadorController],
            providers: [{ provide: NomendadorService, useValue: mockService }],
        }).compile();

        controller = module.get<NomendadorController>(NomendadorController);
        service = module.get<NomendadorService>(NomendadorService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el nomendador creado', () => {
        const dto: CrearNomendadorDto = {
            nombre: 'Dirección General de Compras',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar lista de nomendadores', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Dirección General A' }]);
    });

    it('obtenerPorId() debe retornar un nomendador por ID', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Dirección General A' });
    });

    it('actualizar() debe retornar el nomendador actualizado', () => {
        const dto: ActualizarNomendadorDto = {
            nombre: 'Dirección de Presupuesto',
            fechaDeAlta: new Date('2024-04-05'),
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe retornar confirmación de borrado', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
