// Test unitario para cc.service
import { Test, TestingModule } from '@nestjs/testing';
import { CcService } from './cc.service';
import { getModelToken } from '@nestjs/sequelize';
import { Cc } from './cc.model';
import { CrearCcDto } from './dto/cc.dto';
import { ActualizarCcDto } from './dto/actualizar-cc.dto';

describe('CcService', () => {
    let service: CcService;

    const mockCcModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, descripcion: 'CC A' }])),
        findByPk: jest.fn(id => Promise.resolve({ id, descripcion: 'CC A' })),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CcService,
                {
                    provide: getModelToken(Cc),
                    useValue: mockCcModel,
                },
            ],
        }).compile();

        service = module.get<CcService>(CcService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar nuevo registro', async () => {
        const dto: CrearCcDto = {
            nombre: 'Nuevo CC',
            fechaDeAlta: new Date(),
            usuarioCarga: 'admin'
        }

        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, descripcion: 'Nuevo CC' });
    });

    it('obtenerTodos() debe retornar lista', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, descripcion: 'CC A' }]);
    });

    it('obtenerPorId() debe retornar item por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, descripcion: 'CC A' });
    });

    it('actualizar() debe retornar éxito', async () => {
        const dto: ActualizarCcDto = {
            nombre: 'Nuevo CC',
            fechaDeAlta: new Date(),
            usuarioCarga: 'admin'
        }

        const result = await service.actualizar(1, dto);
        expect(result).toEqual([1]);
    });

    it('eliminar() debe retornar éxito de borrado', async () => {
        const result = await service.eliminar(1);
        expect(result).toEqual(1);
    });
});
