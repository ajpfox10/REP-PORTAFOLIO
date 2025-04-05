// Test unitario para planta.service
import { Test, TestingModule } from '@nestjs/testing';
import { PlantaService } from './planta.service';
import { getModelToken } from '@nestjs/sequelize';
import { Planta } from './planta.model';
import { CrearPlantaDto } from './dto/crear-planta.dto';
import { ActualizarPlantaDto } from './dto/actualizar-planta.dto';

describe('PlantaService', () => {
    let service: PlantaService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Planta A' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                nombre: 'Planta A',
                descripcion: 'Planta ubicada en zona norte',
                fechaDeAlta: new Date(),
                usuarioCarga: 'admin',
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
            }),
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PlantaService,
                {
                    provide: getModelToken(Planta),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<PlantaService>(PlantaService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar la planta creada', async () => {
        const dto: CrearPlantaDto = {
            nombre: 'Planta Central',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todas las plantas', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Planta A' }]);
    });

    it('obtenerPorId() debe retornar una planta por su ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toHaveProperty('id', 1);
        expect(result.nombre).toBe('Planta A');
    });

    it('actualizar() debe aplicar los cambios a la planta', async () => {
        const dto: ActualizarPlantaDto = {
            nombre: 'Planta Renovada',
            fechaDeAlta: new Date('2024-04-02'),
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toHaveProperty('id', 1);
    });

    it('eliminar() debe eliminar correctamente la planta', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
