import '../../test/utils/test-setup'; // ✅ Mock global de JwtAuthGuard y RolesGuard

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
        obtenerTodos: jest.fn(() => []),
        obtenerPorId: jest.fn(id => ({ id })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ eliminado: true })),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CategoriaController],
            providers: [
                { provide: CategoriaService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<CategoriaController>(CategoriaController);
        service = module.get<CategoriaService>(CategoriaService);
    });

    it('debería crear una categoría', async () => {
        const dto: CrearCategoriaDto = { nombre: 'Electrónica', descripcion: 'Categoria de electrónicos' };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(mockService.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todas las categorías', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([]);
        expect(mockService.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener una categoría por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual({ id: 1 });
        expect(mockService.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar una categoría', async () => {
        const dto: ActualizarCategoriaDto = { nombre: 'Actualizado' };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(mockService.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar una categoría', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ eliminado: true });
        expect(mockService.eliminar).toHaveBeenCalledWith(1);
    });
});
