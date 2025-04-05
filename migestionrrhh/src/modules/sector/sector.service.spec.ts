// Test unitario para sector.service
import { Test, TestingModule } from '@nestjs/testing';
import { SectorService } from './sector.service';
import { getModelToken } from '@nestjs/sequelize';
import { Sector } from './sector.model';
import { CrearSectorDto } from './dto/crear-sector.dto';
import { ActualizarSectorDto } from './dto/actualizar-sector.dto';

describe('SectorService', () => {
    let service: SectorService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'TI', usuarioCarga: 'admin' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                nombre: 'TI',
                descripcion: 'Tecnología',
                usuarioCarga: 'admin',
                fechaDeAlta: new Date(),
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
            }),
        ),
        destroy: jest.fn(({ where: { id } }) => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SectorService,
                {
                    provide: getModelToken(Sector),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<SectorService>(SectorService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe crear un sector y retornar el resultado', async () => {
        const dto: CrearSectorDto = {
            nombre: 'TI',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual(expect.objectContaining({ id: 1, nombre: 'TI' }));
    });

    it('obtenerTodos() debe retornar todos los sectores', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'TI', usuarioCarga: 'admin' }]);
    });

    it('obtenerPorId() debe retornar un sector por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result?.id).toBe(1);
        expect(result?.nombre).toBe('TI');
    });

    it('actualizar() debe modificar un sector existente', async () => {
        const dto: ActualizarSectorDto = {
            nombre: 'Mantenimiento',
            usuarioCarga: 'jefe',
        };
        const result = await service.actualizar(1, dto);
        expect(result?.id).toBe(1);
        expect(result?.nombre).toBe('TI'); // Retorna el original porque es mockeado
    });

    it('eliminar() debe eliminar correctamente un sector', async () => {
        const result = await service.eliminar(1);
        expect(result).toBe(1);
    });
});
