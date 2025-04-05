// Test unitario para categoria.controller
import { Test, TestingModule } from '@nestjs/testing';
import { CategoriaController } from './categoria.controller';
import { CategoriaService } from './categoria.service';
import { CrearCategoriaDto } from './dto/categoria.dto';
import { ActualizarCategoriaDto } from './dto/actualizar-categoria.dto';

describe('CategoriaController', () => {
    let controller: CategoriaController;
    let service: CategoriaService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Categoria A' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Categoria A' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CategoriaController],
            providers: [{ provide: CategoriaService, useValue: mockService }],
        }).compile();

        controller = module.get<CategoriaController>(CategoriaController);
        service = module.get<CategoriaService>(CategoriaService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar una nueva categoría', () => {
        const dto: CrearCategoriaDto = { nombre: 'Nueva' };
        expect(controller.crear(dto)).toEqual({ id: 1, nombre: 'Nueva' });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar un arreglo de categorías', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Categoria A' }]);
    });

    it('obtenerPorId() debe retornar una categoría específica', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Categoria A' });
    });

    it('actualizar() debe retornar la categoría modificada', () => {
        const dto: ActualizarCategoriaDto = { nombre: 'Editada' };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, nombre: 'Editada' });
    });

    it('eliminar() debe retornar confirmación de borrado', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
