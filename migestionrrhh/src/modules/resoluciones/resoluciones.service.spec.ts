// Test unitario para resoluciones.service
import { Test, TestingModule } from '@nestjs/testing';
import { ResolucionesService } from './resoluciones.service';
import { getModelToken } from '@nestjs/sequelize';
import { Resolucion } from './resoluciones.model';
import { CrearResolucionDto } from './dto/crear-resolucion.dto';
import { ActualizarResolucionDto } from './dto/actualizar-resolucion.dto';

describe('ResolucionesService', () => {
    let service: ResolucionesService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, resolucion: 'Resolución 123', usuarioCarga: 'admin' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                resolucion: 'Resolución 123',
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
                ResolucionesService,
                {
                    provide: getModelToken(Resolucion),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<ResolucionesService>(ResolucionesService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar la resolución creada', async () => {
        const dto: CrearResolucionDto = {
            resolucion: 'Resolución 123',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodas() debe retornar todas las resoluciones', async () => {
        const result = await service.obtenerTodas();
        expect(result).toEqual([{ id: 1, resolucion: 'Resolución 123', usuarioCarga: 'admin' }]);
    });

    it('buscarPorId() debe retornar una resolución por ID', async () => {
        const result = await service.buscarPorId(1);
        expect(result?.id).toBe(1);
        expect(result?.resolucion).toBe('Resolución 123');
    });

    it('actualizar() debe modificar la resolución', async () => {
        const dto: ActualizarResolucionDto = {
            resolucion: 'Resolución modificada',
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result?.id).toBe(1);
    });

    it('eliminar() debe ejecutar correctamente la eliminación', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
