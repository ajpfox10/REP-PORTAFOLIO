import { Test, TestingModule } from '@nestjs/testing';
import { CccoodegdebaService } from './cccoodegdeba.service';
import { getModelToken } from '@nestjs/sequelize';
import { CCCoodegdeba } from './cccoodegdeba.model';
import { CrearCccoodegdebaDto } from './dto/cccoodegdeba.dto';
import { ActualizarCccoodegdebaDto } from './dto/actualizar-cccoodegdeba.dto';

describe('CccoodegdebaService', () => {
    let service: CccoodegdebaService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, descripcion: 'Registro A' }])),
        findByPk: jest.fn(id => Promise.resolve({ id, descripcion: 'Registro A' })),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CccoodegdebaService,
                {
                    provide: getModelToken(CCCoodegdeba),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<CccoodegdebaService>(CccoodegdebaService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar un objeto creado', async () => {
        const dto: CrearCccoodegdebaDto = {
            descripcion: 'Nuevo registro',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los registros', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, descripcion: 'Registro A' }]);
    });

    it('obtenerPorId() debe retornar el objeto correcto', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, descripcion: 'Registro A' });
    });

    it('actualizar() debe retornar resultado de actualización', async () => {
        const dto: ActualizarCccoodegdebaDto = {
            descripcion: 'Registro actualizado',
            usuarioCarga: 'admin',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toEqual([1]);
    });

    it('eliminar() debe retornar éxito al eliminar', async () => {
        const result = await service.eliminar(1);
        expect(result).toEqual(1);
    });
});
