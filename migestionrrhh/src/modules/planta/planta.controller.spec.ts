// Test unitario para planta.controller
import { Test, TestingModule } from '@nestjs/testing';
import { PlantaController } from './planta.controller';
import { PlantaService } from './planta.service';
import { CrearPlantaDto } from './dto/crear-planta.dto';
import { ActualizarPlantaDto } from './dto/actualizar-planta.dto';

describe('PlantaController', () => {
    let controller: PlantaController;
    let service: PlantaService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Planta A' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Planta A' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PlantaController],
            providers: [{ provide: PlantaService, useValue: mockService }],
        }).compile();

        controller = module.get<PlantaController>(PlantaController);
        service = module.get<PlantaService>(PlantaService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar la planta creada', () => {
        const dto: CrearPlantaDto = {
            nombre: 'Planta Central',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todas las plantas', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Planta A' }]);
    });

    it('obtenerPorId() debe retornar una planta específica', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Planta A' });
    });

    it('actualizar() debe retornar la planta modificada', () => {
        const dto: ActualizarPlantaDto = {
            nombre: 'Planta Modificada',
            fechaDeAlta: new Date('2024-04-02'),
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe confirmar eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
