// Test unitario para regimenhorarios.controller
import { Test, TestingModule } from '@nestjs/testing';
import { RegimenhorariosController } from './regimenhorarios.controller';
import { RegimenhorariosService } from './regimenhorarios.service';
import { CrearRegimenhorariosDto } from './dto/crear-regimenhorarios.dto';
import { ActualizarRegimenhorariosDto } from './dto/actualizar-regimenhorarios.dto';

describe('RegimenhorariosController', () => {
    let controller: RegimenhorariosController;
    let service: RegimenhorariosService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Régimen Semanal' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Régimen Semanal' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [RegimenhorariosController],
            providers: [{ provide: RegimenhorariosService, useValue: mockService }],
        }).compile();

        controller = module.get<RegimenhorariosController>(RegimenhorariosController);
        service = module.get<RegimenhorariosService>(RegimenhorariosService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el régimen creado', () => {
        const dto: CrearRegimenhorariosDto = {
            nombre: 'Régimen Semanal',
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todos los regímenes', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Régimen Semanal' }]);
    });

    it('obtenerPorId() debe retornar un régimen específico', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Régimen Semanal' });
    });

    it('actualizar() debe retornar el régimen actualizado', () => {
        const dto: ActualizarRegimenhorariosDto = {
            nombre: 'Régimen Intensivo',
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
