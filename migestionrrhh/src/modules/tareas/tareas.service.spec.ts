// Test unitario para tareas.service
import { Test, TestingModule } from '@nestjs/testing';
import { TareasService } from './tareas.service';
import { getModelToken } from '@nestjs/sequelize';
import { Tareas } from './tareas.model';
import { CrearTareasDto } from './dto/crear-tareas.dto';
import { ActualizarTareasDto } from './dto/actualizar-tareas.dto';

describe('TareasService', () => {
    let service: TareasService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ ID: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ ID: 1, tarea: 'Ejemplo' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                ID: id,
                tarea: 'Ejemplo',
                usuarioCarga: 'admin',
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
            }),
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TareasService,
                {
                    provide: getModelToken(Tareas),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<TareasService>(TareasService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar una tarea creada', async () => {
        const dto: CrearTareasDto = {
            tarea: 'Revisión',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto, 'admin');
        expect(result).toEqual(expect.objectContaining({ tarea: 'Revisión', usuarioCarga: 'admin' }));
    });

    it('obtenerTodos() debe retornar todas las tareas', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ ID: 1, tarea: 'Ejemplo' }]);
    });

    it('obtenerPorId() debe retornar una tarea específica', async () => {
        const result = await service.obtenerPorId(1);
        expect(result?.ID).toBe(1);
        expect(result?.tarea).toBe('Ejemplo');
    });

    it('actualizar() debe modificar una tarea', async () => {
        const dto: ActualizarTareasDto = {
            tarea: 'Actualizada',
        };
        const result = await service.actualizar(1, dto);
        expect(result.ID).toBe(1);
        expect(result.tarea).toBe('Ejemplo'); // Valor del mock
    });

    it('eliminar() debe eliminar la tarea', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
