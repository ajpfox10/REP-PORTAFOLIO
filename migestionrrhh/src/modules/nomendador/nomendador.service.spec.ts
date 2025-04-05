// Test unitario para nomendador.service
import { Test, TestingModule } from '@nestjs/testing';
import { NomendadorService } from './nomendador.service';
import { getModelToken } from '@nestjs/sequelize';
import { Nomendador } from './nomendador.model';
import { CrearNomendadorDto } from './dto/crear-nomendador.dto';
import { ActualizarNomendadorDto } from './dto/actualizar-nomendador.dto';

describe('NomendadorService', () => {
    let service: NomendadorService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Nomendador A' }])),
        findByPk: jest.fn(id => Promise.resolve({ id, nombre: 'Nomendador A' })),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                NomendadorService,
                {
                    provide: getModelToken(Nomendador),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<NomendadorService>(NomendadorService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar un nuevo nomendador', async () => {
        const dto: CrearNomendadorDto = {
            nombre: 'Nuevo Nomendador',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los nomendadores', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Nomendador A' }]);
    });

    it('obtenerPorId() debe retornar un nomendador por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Nomendador A' });
    });

    it('actualizar() debe retornar el nomendador actualizado', async () => {
        const dto: ActualizarNomendadorDto = {
            nombre: 'Actualizado',
            fechaDeAlta: new Date('2024-04-02'),
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
