import '../../test/utils/test-setup'; // ✅ Mocks globales de JwtAuthGuard y RolesGuard

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

    it('crear() debe retornar el nomendador creado', async () => {
        const dto: CrearNomendadorDto = {
            nombre: 'Dirección General de Compras',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar lista de nomendadores', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Dirección General A' }]);
    });

    it('obtenerPorId() debe retornar un nomendador por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Dirección General A' });
    });

    it('actualizar() debe retornar el nomendador actualizado', async () => {
        const dto: ActualizarNomendadorDto = {
            nombre: 'Dirección de Presupuesto',
            fechaDeAlta: new Date('2024-04-05'),
            usuarioCarga: 'editor',
        };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe retornar confirmación de borrado', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ deleted: true });
    });
});
