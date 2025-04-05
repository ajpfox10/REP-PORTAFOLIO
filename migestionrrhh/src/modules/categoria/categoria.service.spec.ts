// Test unitario para categoria.
import { Test, TestingModule } from '@nestjs/testing';
import { CategoriaService } from './categoria.service';
import { getModelToken } from '@nestjs/sequelize';
import { Categoria } from './categoria.model';
import { CrearCategoriaDto } from './dto/categoria.dto';
import { ActualizarCategoriaDto } from './dto/actualizar-categoria.dto';

describe('CategoriaService', () => {
    let service: CategoriaService;

    const mockCategoriaModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Categoria A' }])),
        findByPk: jest.fn(id => Promise.resolve({ id, nombre: 'Categoria A' })),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CategoriaService,
                {
                    provide: getModelToken(Categoria),
                    useValue: mockCategoriaModel,
                },
            ],
        }).compile();

        service = module.get<CategoriaService>(CategoriaService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe guardar y retornar una nueva categoría', async () => {
        const dto: CrearCategoriaDto = { nombre: 'Nueva' };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, nombre: 'Nueva' });
    });

    it('obtenerTodos() debe retornar todas las categorías', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Categoria A' }]);
    });

    it('obtenerPorId() debe retornar una categoría específica', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Categoria A' });
    });

    it('actualizar() debe modificar y retornar éxito', async () => {
        const dto: ActualizarCategoriaDto = { nombre: 'Editada' };
        const result = await service.actualizar(1, dto);
        expect(result).toEqual([1]);
    });

    it('eliminar() debe retornar éxito de eliminación', async () => {
        const result = await service.eliminar(1);
        expect(result).toEqual(1);
    });
});
