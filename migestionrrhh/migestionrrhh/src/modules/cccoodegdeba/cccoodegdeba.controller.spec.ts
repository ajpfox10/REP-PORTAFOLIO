import '../../test/utils/test-setup'; // ✅ Mocks globales activos

import { Test, TestingModule } from '@nestjs/testing';
import { CccoodegdebaController } from './cccoodegdeba.controller';
import { CccoodegdebaService } from './cccoodegdeba.service';
import { CrearCccoodegdebaDto } from './dto/cccoodegdeba.dto';
import { ActualizarCccoodegdebaDto } from './dto/actualizar-cccoodegdeba.dto';

describe('CccoodegdebaController', () => {
    let controller: CccoodegdebaController;
    let service: CccoodegdebaService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, descripcion: 'Item 1' }]),
        obtenerPorId: jest.fn(id => ({ id, descripcion: 'Item encontrado' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => undefined),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CccoodegdebaController],
            providers: [
                { provide: CccoodegdebaService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<CccoodegdebaController>(CccoodegdebaController);
        service = module.get<CccoodegdebaService>(CccoodegdebaService);
    });

    it('debería crear un registro', async () => {
        const dto: CrearCccoodegdebaDto = { descripcion: 'Nuevo registro', usuarioCarga: 'admin' };
        const result = await controller.crear(dto);
        expect(result).toEqual(expect.objectContaining(dto));
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todos los registros', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([{ id: 1, descripcion: 'Item 1' }]);
    });

    it('debería obtener un registro por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual({ id: 1, descripcion: 'Item encontrado' });
    });

    it('debería actualizar un registro', async () => {
        const dto: ActualizarCccoodegdebaDto = { usuarioCarga: 'otro' };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('debería eliminar un registro', async () => {
        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
    });
});
