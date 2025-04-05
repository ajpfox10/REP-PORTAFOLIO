import { Test, TestingModule } from '@nestjs/testing';
import { CcController } from './cc.controller';
import { CcService } from './cc.service';
import { CrearCcDto } from './dto/cc.dto';
import { ActualizarCcDto } from './dto/actualizar-cc.dto';

describe('CcController', () => {
    let controller: CcController;
    let service: CcService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'CC A' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'CC A' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CcController],
            providers: [{ provide: CcService, useValue: mockService }],
        }).compile();

        controller = module.get<CcController>(CcController);
        service = module.get<CcService>(CcService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el nuevo objeto', () => {
        const dto: CrearCcDto = {
            nombre: 'Nuevo CC',
            fechaDeAlta: new Date(),
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar lista de objetos', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'CC A' }]);
    });

    it('obtenerPorId() debe retornar objeto con ID', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'CC A' });
    });

    it('actualizar() debe retornar objeto actualizado', () => {
        const dto: ActualizarCcDto = {
            nombre: 'Modificado',
            fechaDeAlta: new Date(),
            usuarioCarga: 'admin',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
