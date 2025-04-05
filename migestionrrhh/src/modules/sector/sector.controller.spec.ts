// Test unitario para sector.controller
import { Test, TestingModule } from '@nestjs/testing';
import { SectorController } from './sector.controller';
import { SectorService } from './sector.service';
import { CrearSectorDto } from './dto/crear-sector.dto';
import { ActualizarSectorDto } from './dto/actualizar-sector.dto';

describe('SectorController', () => {
    let controller: SectorController;
    let service: SectorService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'TI', usuarioCarga: 'admin' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'TI', usuarioCarga: 'admin' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SectorController],
            providers: [{ provide: SectorService, useValue: mockService }],
        }).compile();

        controller = module.get<SectorController>(SectorController);
        service = module.get<SectorService>(SectorService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el sector creado', () => {
        const dto: CrearSectorDto = {
            nombre: 'TI',
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los sectores', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'TI', usuarioCarga: 'admin' }]);
    });

    it('obtenerPorId() debe retornar un sector por ID', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'TI', usuarioCarga: 'admin' });
    });

    it('actualizar() debe retornar el sector actualizado', () => {
        const dto: ActualizarSectorDto = {
            nombre: 'Mantenimiento',
            usuarioCarga: 'admin',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar borrado', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
