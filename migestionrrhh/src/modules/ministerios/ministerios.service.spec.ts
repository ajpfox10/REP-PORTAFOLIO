// Test unitario para ministerios.service
import { Test, TestingModule } from '@nestjs/testing';
import { MinisteriosService } from './ministerios.service';
import { getModelToken } from '@nestjs/sequelize';
import { Ministerios } from './ministerios.model';
import { CrearMinisteriosDto } from './dto/crear-ministerios.dto';
import { ActualizarMinisteriosDto } from './dto/actualizar-ministerios.dto';

describe('MinisteriosService', () => {
    let service: MinisteriosService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Ministerio de Salud' }])),
        findByPk: jest.fn(id => Promise.resolve({ id, nombre: 'Ministerio de Salud' })),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MinisteriosService,
                {
                    provide: getModelToken(Ministerios),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<MinisteriosService>(MinisteriosService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar un nuevo ministerio', async () => {
        const dto: CrearMinisteriosDto = {
            nombre: 'Ministerio de Salud',
            fechaDeAlta: new Date('2024-03-31'),
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los ministerios', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Ministerio de Salud' }]);
    });

    it('obtenerPorId() debe retornar un ministerio por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Ministerio de Salud' });
    });

    it('actualizar() debe retornar el ministerio actualizado', async () => {
        const dto: ActualizarMinisteriosDto = {
            nombre: 'Ministerio de Educación',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe ejecutar correctamente el borrado', async () => {
        const result = await service.eliminar(1);
        expect(result).toBeUndefined();
    });
});
