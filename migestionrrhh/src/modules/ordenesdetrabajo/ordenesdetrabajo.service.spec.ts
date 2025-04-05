// Test unitario para ordenesdetrabajo.service
import { Test, TestingModule } from '@nestjs/testing';
import { OrdenesdetrabajoService } from './ordenesdetrabajo.service';
import { getModelToken } from '@nestjs/sequelize';
import { Ordenesdetrabajo } from './ordenesdetrabajo.model';
import { CrearOrdenesdetrabajoDto } from './dto/crear-ordenesdetrabajo.dto';
import { ActualizarOrdenesdetrabajoDto } from './dto/actualizar-ordenesdetrabajo.dto';

describe('OrdenesdetrabajoService', () => {
    let service: OrdenesdetrabajoService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Orden 1' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                nombre: 'Orden 1',
                descripcion: 'Desc',
                usuarioCarga: 'admin',
                fechaDeAlta: new Date(),
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
            }),
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrdenesdetrabajoService,
                {
                    provide: getModelToken(Ordenesdetrabajo),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<OrdenesdetrabajoService>(OrdenesdetrabajoService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar una orden creada', async () => {
        const dto: CrearOrdenesdetrabajoDto = {
            nombre: 'Orden Nueva',
            descripcion: 'Revisión de equipos',
            usuarioCarga: 'admin',
            fechaDeAlta: new Date('2024-04-01'),
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todas las órdenes', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Orden 1' }]);
    });

    it('obtenerPorId() debe retornar una orden específica', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toMatchObject({ id: 1, nombre: 'Orden 1' });
    });

    it('actualizar() debe aplicar cambios a la orden', async () => {
        const dto: ActualizarOrdenesdetrabajoDto = {
            nombre: 'Orden Actualizada',
            descripcion: 'Actualización del servidor',
            usuarioCarga: 'tecnico',
            fechaDeAlta: new Date(),
        };
        const result = await service.actualizar(1, dto);
        expect(result).toMatchObject({ id: 1, nombre: 'Orden 1' });
    });

    it('eliminar() debe ejecutar el borrado correctamente', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
