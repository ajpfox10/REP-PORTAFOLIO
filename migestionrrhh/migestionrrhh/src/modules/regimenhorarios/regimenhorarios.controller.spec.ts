import '../../test/utils/test-setup'; // ✅ Mocks globales activos

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
        eliminar: jest.fn(() => ({ deleted: true })),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            controllers: [RegimenhorariosController],
            providers: [
                { provide: RegimenhorariosService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<RegimenhorariosController>(RegimenhorariosController);
        service = module.get<RegimenhorariosService>(RegimenhorariosService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el régimen creado', async () => {
        const dto: CrearRegimenhorariosDto = {
            nombre: 'Régimen Semanal',
            usuarioCarga: 'admin',
        };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todos los regímenes', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Régimen Semanal' }]);
        expect(service.obtenerTodos).toHaveBeenCalled();
    });

    it('obtenerPorId() debe retornar un régimen específico', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Régimen Semanal' });
        expect(service.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('actualizar() debe retornar el régimen actualizado', async () => {
        const dto: ActualizarRegimenhorariosDto = {
            nombre: 'Régimen Intensivo',
            usuarioCarga: 'editor',
        };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(service.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('eliminar() debe confirmar eliminación', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ deleted: true });
        expect(service.eliminar).toHaveBeenCalledWith(1);
    });
});
