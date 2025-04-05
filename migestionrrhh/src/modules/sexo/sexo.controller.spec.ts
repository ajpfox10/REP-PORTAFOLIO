// Test unitario para sexo.controller
import { Test, TestingModule } from '@nestjs/testing';
import { SexoController } from './sexo.controller';
import { SexoService } from './sexo.service';
import { ActualizarSexoDto } from './dto/actualizar-sexo.dto';

describe('SexoController', () => {
    let controller: SexoController;
    let service: SexoService;

    const mockService = {
        obtenerTodos: jest.fn(() => [{ id: 1, descripcion: 'Masculino' }]),
        obtenerPorId: jest.fn(id => ({ id, descripcion: 'Masculino' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SexoController],
            providers: [{ provide: SexoService, useValue: mockService }],
        }).compile();

        controller = module.get<SexoController>(SexoController);
        service = module.get<SexoService>(SexoService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('obtenerTodos() debe retornar todos los sexos', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, descripcion: 'Masculino' }]);
    });

    it('obtenerPorId() debe retornar un sexo por ID', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, descripcion: 'Masculino' });
    });

    it('actualizar() debe retornar el sexo actualizado', () => {
        const dto: ActualizarSexoDto = {
            nombre: 'Femenino',
            usuarioCarga: 'admin',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar borrado', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
