// Test unitario para tareas.controller
import { Test, TestingModule } from '@nestjs/testing';
import { TareasController } from './tareas.controller';
import { TareasService } from './tareas.service';
import { CrearTareasDto } from './dto/crear-tareas.dto';
import { ActualizarTareasDto } from './dto/actualizar-tareas.dto';

describe('TareasController', () => {
    let controller: TareasController;
    let service: TareasService;

    const mockService = {
        crear: jest.fn((dto, usuario) => ({ id: 1, ...dto, usuarioCarga: usuario })),
        obtenerTodos: jest.fn(() => [{ ID: 1, tarea: 'Test', usuarioCarga: 'admin' }]),
        obtenerPorId: jest.fn(id => ({ ID: id, tarea: 'Revisión' })),
        actualizar: jest.fn((id, dto) => ({ ID: id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [TareasController],
            providers: [{ provide: TareasService, useValue: mockService }],
        }).compile();

        controller = module.get<TareasController>(TareasController);
        service = module.get<TareasService>(TareasService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar la tarea creada', async () => {
        const dto: CrearTareasDto = {
            tarea: 'Test',
            usuarioCarga: 'admin',
        };
        const result = await controller.crear(dto, { user: { usuario: 'admin' } });
        expect(result).toEqual(expect.objectContaining({ tarea: 'Test', usuarioCarga: 'admin' }));
    });

    it('obtenerTodos() debe retornar todas las tareas', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([{ ID: 1, tarea: 'Test', usuarioCarga: 'admin' }]);
    });

    it('obtenerPorId() debe retornar una tarea específica', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result.ID).toBe(1);
    });

    it('actualizar() debe modificar una tarea', async () => {
        const dto: ActualizarTareasDto = {
            tarea: 'Actualizada',
        };
        const result = await controller.actualizar(1, dto);
        expect(result.ID).toBe(1);
        expect(result.tarea).toBe('Actualizada');
    });

    it('eliminar() debe confirmar eliminación', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ deleted: true });
    });
});
