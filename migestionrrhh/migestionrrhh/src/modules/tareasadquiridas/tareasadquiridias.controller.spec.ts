import '../../test/utils/test-setup'; // ✅ mocks globales activos

import { Test, TestingModule } from '@nestjs/testing';
import { TareasadquiridiasController } from './tareasadquiridias.controller';
import { TareasadquiridiasService } from './tareasadquiridias.service';
import { CrearTareasadquiridiasDto } from './dto/crear-tareasadquiridias.dto';
import { ActualizarTareasadquiridiasDto } from './dto/actualizar-tareasadquiridias.dto';

describe('TareasadquiridiasController', () => {
    let controller: TareasadquiridiasController;
    let service: TareasadquiridiasService;

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
            controllers: [TareasadquiridiasController],
            providers: [
                {
                    provide: TareasadquiridiasService,
                    useValue: mockService,
                },
            ],
        }).compile();

        controller = module.get<TareasadquiridiasController>(TareasadquiridiasController);
        service = module.get<TareasadquiridiasService>(TareasadquiridiasService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar la tarea adquirida creada', async () => {
        const dto: CrearTareasadquiridiasDto = {
            agenteDeTrabajo: 'Juan Pérez',
            agente: 123,
            tareaAdquirida: 456,
            fechaDeAdquisicion: new Date('2024-04-01'),
            memo: 'Memo 01',
            estado: 1,
            fechaDeFinalizacion: new Date('2024-04-10'),
        };
        const req: any = { user: { usuario: 'admin' } };
        const esperado = { id: 1, ...dto, usuarioCarga: 'admin' };

        mockService.crear.mockResolvedValue(esperado);

        const result = await controller.crear(dto, req);
        expect(result).toEqual(esperado);
        expect(service.crear).toHaveBeenCalledWith(dto, 'admin');
    });

    it('obtenerTodos() debe retornar todas las tareas adquiridas', async () => {
        const data = [
            { id: 1, agenteDeTrabajo: 'Agente A' },
            { id: 2, agenteDeTrabajo: 'Agente B' },
        ];
        mockService.obtenerTodos.mockResolvedValue(data);

        const result = await controller.obtenerTodos();
        expect(result).toEqual(data);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('obtenerPorId() debe retornar una tarea específica', async () => {
        const data = { id: 1, agenteDeTrabajo: 'Agente A' };
        mockService.obtenerPorId.mockResolvedValue(data);

        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(data);
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('actualizar() debe modificar una tarea adquirida', async () => {
        const dto: ActualizarTareasadquiridiasDto = { memo: 'Nuevo memo' };
        const esperado = { id: 1, memo: 'Nuevo memo' };

        mockService.actualizar.mockResolvedValue(esperado);

        const result = await controller.actualizar(1, dto);
        expect(result).toEqual(esperado);
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('eliminar() debe eliminar una tarea adquirida', async () => {
        mockService.eliminar.mockResolvedValue(undefined);

        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});

