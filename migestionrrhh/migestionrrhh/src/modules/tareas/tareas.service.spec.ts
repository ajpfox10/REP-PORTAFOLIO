import { Test, TestingModule } from '@nestjs/testing';
import { TareasService } from './tareas.service';
import { getModelToken } from '@nestjs/sequelize';
import { Tareas } from './tareas.model';
import { NotFoundException } from '@nestjs/common';
import { CrearTareasDto } from './dto/crear-tareas.dto';

describe('TareasService', () => {
    let service: TareasService;

    // Definimos un tipo para nuestro mock de instancia
    type MockTareaInstance = {
        id: number;
        tarea: string;
        usuarioCarga: string;
        update: jest.Mock;
        destroy: jest.Mock;
        save: jest.Mock;
        toJSON: () => any;
    };

    // Creamos el mock de instancia
    const createMockInstance = (overrides?: Partial<MockTareaInstance>): MockTareaInstance => ({
        id: 1,
        tarea: 'Tarea ejemplo',
        usuarioCarga: 'admin',
        update: jest.fn().mockImplementation(function (this: MockTareaInstance, dto: Partial<Tareas>) {
            Object.assign(this, dto);
            return Promise.resolve(this);
        }),
        destroy: jest.fn().mockResolvedValue(1),
        save: jest.fn().mockResolvedValue(this),
        toJSON: jest.fn().mockReturnValue(this),
        ...overrides
    });

    let mockInstance: MockTareaInstance;
    let modelMock: any;

    beforeEach(async () => {
        mockInstance = createMockInstance();

        // Mock completo del modelo Tareas
        modelMock = {
            create: jest.fn((dto: CrearTareasDto & { usuarioCarga: string, fechaDeAlta: Date }) => {
                const newInstance = createMockInstance({
                    ...dto,
                    id: 1
                });
                return Promise.resolve(newInstance);
            }),
            findAll: jest.fn(() => Promise.resolve([mockInstance])),
            findByPk: jest.fn((id: number) =>
                id === 1 ? Promise.resolve(mockInstance) : Promise.resolve(null)
            ),
            destroy: jest.fn((options: { where: { id: number } }) =>
                Promise.resolve(options.where.id === 1 ? 1 : 0)
            ),
            build: jest.fn((dto: any) => createMockInstance(dto)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TareasService,
                {
                    provide: getModelToken(Tareas),
                    useValue: modelMock,
                },
            ],
        }).compile();

        service = module.get<TareasService>(TareasService);
    });

    describe('crear()', () => {
        it('debería crear una nueva tarea', async () => {
            const dto: CrearTareasDto = {
                tarea: 'Nueva tarea',
                usuarioCarga: 'admin' // Asegúrate de incluir todas las propiedades requeridas
            };

            const result = await service.crear(dto, 'admin');

            expect(result).toMatchObject({
                id: 1,
                tarea: 'Nueva tarea',
                usuarioCarga: 'admin'
            });
            expect(modelMock.create).toHaveBeenCalledWith({
                ...dto,
                usuarioCarga: 'admin',
                fechaDeAlta: expect.any(Date)
            });
        });
    });

    describe('obtenerTodos()', () => {
        it('debería retornar todas las tareas', async () => {
            const result = await service.obtenerTodos();
            expect(result).toEqual([expect.objectContaining({
                id: 1,
                tarea: 'Tarea ejemplo'
            })]);
        });
    });

    describe('obtenerPorId()', () => {
        it('debería retornar una tarea por ID', async () => {
            const result = await service.obtenerPorId(1);
            expect(result).toEqual(expect.objectContaining({
                id: 1,
                tarea: 'Tarea ejemplo'
            }));
        });

        it('debería lanzar NotFoundException si no existe', async () => {
            modelMock.findByPk.mockResolvedValueOnce(null);
            await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
        });
    });

    describe('actualizar()', () => {
        it('debería modificar una tarea existente', async () => {
            const dto = { tarea: 'Actualizada' };
            const result = await service.actualizar(1, dto);
            expect(result).toMatchObject({
                id: 1,
                tarea: 'Actualizada'
            });
        });

        it('debería lanzar NotFoundException si no existe', async () => {
            modelMock.findByPk.mockResolvedValueOnce(null);
            await expect(service.actualizar(999, {})).rejects.toThrow(NotFoundException);
        });
    });

    describe('eliminar()', () => {
        it('debería eliminar una tarea existente', async () => {
            const result = await service.eliminar(1);
            expect(result).toBe(1);
        });

        it('debería lanzar NotFoundException si no existe', async () => {
            modelMock.destroy.mockResolvedValueOnce(0);
            await expect(service.eliminar(999)).rejects.toThrow(NotFoundException);
        });
    });
});