import '../../test/utils/test-setup'; // ✅ mocks globales activos

import { Test, TestingModule } from '@nestjs/testing';
import { TareasController } from './tareas.controller';
import { TareasService } from './tareas.service';
import { CrearTareasDto } from './dto/crear-tareas.dto';
import { ActualizarTareasDto } from './dto/actualizar-tareas.dto';

describe('TareasController', () => {
    let controller: TareasController;
    let service: TareasService;

    const mockService = {
        crear: jest.fn(),
        obtenerTodos: jest.fn(),
        obtenerPorId: jest.fn(),
        actualizar: jest.fn(),
        eliminar: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [TareasController],
            providers: [
                {
                    provide: TareasService,
                    useValue: mockService,
                },
            ],
        }).compile();

        controller = module.get<TareasController>(TareasController);
        service = module.get<TareasService>(TareasService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('debería crear una tarea', async () => {
        const dto: CrearTareasDto = {
            tarea: 'Tarea A',
            usuarioCarga: 'admin',
        };
        const req = { user: { usuario: 'admin' } };

        const esperado = { id: 1, ...dto };
        mockService.crear.mockResolvedValue(esperado);

        const result = await controller.crear(dto, req as any);
        expect(result).toEqual(esperado);
        expect(service.crear).toHaveBeenCalledWith(dto, req.user.usuario);
    });

    it('debería obtener todas las tareas', async () => {
        const esperado = [{ id: 1, tarea: 'Tarea A', usuarioCarga: 'admin' }];
        mockService.obtenerTodos.mockResolvedValue(esperado);

        const result = await controller.obtenerTodos();
        expect(result).toEqual(esperado);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener una tarea por ID', async () => {
        const esperado = { id: 1, tarea: 'Tarea A', usuarioCarga: 'admin' };
        mockService.obtenerPorId.mockResolvedValue(esperado);

        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(esperado);
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar una tarea', async () => {
        const id = 1;
        const dto: ActualizarTareasDto = {
            tarea: 'Modificada',
        };
        const esperado = { id, ...dto, usuarioCarga: 'admin' };
        mockService.actualizar.mockResolvedValue(esperado);

        const result = await controller.actualizar(id, dto);
        expect(result).toEqual(esperado);
        expect(service.actualizar).toHaveBeenCalledWith(id, dto);
    });

    it('debería eliminar una tarea', async () => {
        mockService.eliminar.mockResolvedValue(undefined);

        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});
