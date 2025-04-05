// Test unitario para rangoshorarios.service
import { Test, TestingModule } from '@nestjs/testing';
import { RangoshorariosService } from './rangoshorarios.service';
import { getModelToken } from '@nestjs/sequelize';
import { Rangoshorarios } from './rangoshorarios.model';
import { CrearRangoshorariosDto } from './dto/crear-rangoshorarios.dto';
import { ActualizarRangoshorariosDto } from './dto/actualizar-rangoshorarios.dto';

describe('RangoshorariosService', () => {
    let service: RangoshorariosService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Turno Mañana' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                nombre: 'Turno Mañana',
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
                RangoshorariosService,
                {
                    provide: getModelToken(Rangoshorarios),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<RangoshorariosService>(RangoshorariosService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe crear y retornar un rango horario', async () => {
        const dto: CrearRangoshorariosDto = {
            nombre: 'Turno Mañana',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los rangos horarios', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Turno Mañana' }]);
    });

    it('obtenerPorId() debe retornar un rango por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result.id).toBe(1);
        expect(result.descripcion).toBe('Turno Mañana');
    });

    it('actualizar() debe aplicar los cambios al rango', async () => {
        const dto: ActualizarRangoshorariosDto = {
            nombre: 'Turno Noche',
            fechaDeAlta: new Date('2024-04-02'),
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toHaveProperty('id', 1);
    });

    it('eliminar() debe eliminar correctamente un rango horario', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
