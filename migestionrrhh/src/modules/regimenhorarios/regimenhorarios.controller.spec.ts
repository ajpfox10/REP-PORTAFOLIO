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
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'R�gimen Semanal' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'R�gimen Semanal' })),
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

    it('deber�a estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el r�gimen creado', () => {
        const dto: CrearRegimenhorariosDto = {
            nombre: 'R�gimen Semanal',
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todos los reg�menes', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'R�gimen Semanal' }]);
    });

    it('obtenerPorId() debe retornar un r�gimen espec�fico', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'R�gimen Semanal' });
    });

    it('actualizar() debe retornar el r�gimen actualizado', () => {
        const dto: ActualizarRegimenhorariosDto = {
            nombre: 'R�gimen Intensivo',
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar eliminaci�n', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
