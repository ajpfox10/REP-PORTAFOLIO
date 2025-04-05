import { Test, TestingModule } from '@nestjs/testing';
import { TareasadquiridiasController } from './tareasadquiridias.controller';
import { TareasadquiridiasService } from './tareasadquiridias.service';
import { CrearTareasadquiridiasDto } from './dto/crear-tareasadquiridias.dto';
import { ActualizarTareasadquiridiasDto } from './dto/actualizar-tareasadquiridias.dto';

describe('TareasadquiridiasController', () => {
    let controller: TareasadquiridiasController;
    let service: TareasadquiridiasService;

    const mockService = {
        crear: jest.fn((dto, usuario) => ({ id: 1, ...dto, usuarioCarga: usuario })),
        obtenerTodos: jest.fn(() => [{ id: 1, agenteDeTrabajo: 'Juan', memo: 'M1' }]),
        obtenerPorId: jest.fn(id => ({ id, agenteDeTrabajo: 'Juan', memo: 'M1' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [TareasadquiridiasController],
            providers: [{ provide: TareasadquiridiasService, useValue: mockService }],
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
            agente: 101,
            tareaAdquirida: 555,
            fechaDeAdquisicion: new Date('2024-04-01'),
            memo: 'Memo A',
            estado: 1,
            fechaDeFinalizacion: new Date('2024-04-30'),
            usuarioCarga: 'admin',
        };
        const result = await controller.crear(dto, { user: { usuario: 'admin' } });
        expect(result).toEqual(expect.objectContaining({ id: 1, agenteDeTrabajo: 'Juan Pérez' }));
    });

    it('obtenerTodos() debe retornar todas las tareas adquiridas', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([{ id: 1, agenteDeTrabajo: 'Juan', memo: 'M1' }]);
    });

    it('obtenerPorId() debe retornar una tarea específica', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result.id).toBe(1);
        expect(result.descripcion).toBe('M1');
    });

    it('actualizar() debe retornar la tarea actualizada', async () => {
        const dto: ActualizarTareasadquiridiasDto = {
            memo: 'Memo actualizado',
            estado: 0,
        };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar borrado', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ deleted: true });
    });
});
