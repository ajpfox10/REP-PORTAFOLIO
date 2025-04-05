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
        obtenerTodos: jest.fn(() => [{ id: 1, descripcion: 'Registro A' }]),
        obtenerPorId: jest.fn(id => ({ id, descripcion: 'Registro A' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CccoodegdebaController],
            providers: [{ provide: CccoodegdebaService, useValue: mockService }],
        }).compile();

        controller = module.get<CccoodegdebaController>(CccoodegdebaController);
        service = module.get<CccoodegdebaService>(CccoodegdebaService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar un nuevo objeto', () => {
        const dto: CrearCccoodegdebaDto = {
            descripcion: 'Nuevo registro',
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar lista de registros', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, descripcion: 'Registro A' }]);
    });

    it('obtenerPorId() debe retornar un registro por ID', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, descripcion: 'Registro A' });
    });

    it('actualizar() debe retornar el registro actualizado', () => {
        const dto: ActualizarCccoodegdebaDto = {
            descripcion: 'Actualizado',
            usuarioCarga: 'admin',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe retornar confirmación de borrado', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
