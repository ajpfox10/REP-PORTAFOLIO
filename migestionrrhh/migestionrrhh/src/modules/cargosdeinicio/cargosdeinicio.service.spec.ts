import { Test, TestingModule } from '@nestjs/testing';
import { CargosdeinicioService } from './cargosdeinicio.service';
import { Cargosdeinicio } from './cargosdeinicio.model';
import { getModelToken } from '@nestjs/sequelize';
import '../../test/utils/test-setup';  // Ajusta la ruta según corresponda


describe('CargosdeinicioService', () => {
    let service: CargosdeinicioService;
    let model: any;

    const mockCargosdeinicio = {
        id: 1,
        cargo: 'Test Cargo',
        descripcion: 'Test Description',
        fechaDeAlta: new Date(),
        usuarioCarga: 'admin',
        update: jest.fn().mockResolvedValue({
            id: 1,
            cargo: 'Updated Cargo',
            descripcion: 'Updated Description',
            fechaDeAlta: new Date(),
            usuarioCarga: 'admin',
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    const mockModel = {
        create: jest.fn().mockResolvedValue(mockCargosdeinicio),
        findAll: jest.fn().mockResolvedValue([mockCargosdeinicio]),
        findByPk: jest.fn().mockImplementation((id: number) => {
            return id === 1 ? Promise.resolve(mockCargosdeinicio) : Promise.resolve(null);
        }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CargosdeinicioService,
                {
                    provide: getModelToken(Cargosdeinicio),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<CargosdeinicioService>(CargosdeinicioService);
        model = module.get(getModelToken(Cargosdeinicio));
    });

    it('should create a new cargo', async () => {
        const dto = {
            cargo: 'Test Cargo',
            descripcion: 'Test Description',
            fechaDeAlta: new Date(),
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual(mockCargosdeinicio);
        // Verifica que se llamó a create con el DTO extendido con fecha de alta (puede ser nueva)
        expect(model.create).toHaveBeenCalledWith({ ...dto, fechaDeAlta: expect.any(Date) });
    });

    it('should get all cargos', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([mockCargosdeinicio]);
        expect(model.findAll).toHaveBeenCalled();
    });

    it('should get cargo by id', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual(mockCargosdeinicio);
        expect(model.findByPk).toHaveBeenCalledWith(1);
    });

    it('should update cargo', async () => {
        const dto = {
            cargo: 'Updated Cargo',
            descripcion: 'Updated Description',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toEqual({
            id: 1,
            cargo: 'Updated Cargo',
            descripcion: 'Updated Description',
            fechaDeAlta: expect.any(Date),
            usuarioCarga: 'admin',
        });
        expect(mockCargosdeinicio.update).toHaveBeenCalledWith(dto);
    });

    it('should delete cargo', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
        expect(mockCargosdeinicio.destroy).toHaveBeenCalled();
    });
});
