import { Test, TestingModule } from '@nestjs/testing';
import { CargosdeinicioService } from './cargosdeinicio.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cargosdeinicio } from './cargosdeinicio.model';

describe('CargosdeinicioService', () => {
    let service: CargosdeinicioService;
    let model: Model<Cargosdeinicio>;

    // Datos de prueba (se incluye 'descripcion' ya que es requerido)
    const cargoDeInicioMock = {
        cargo: 'Cargo de Prueba',
        descripcion: 'Descripción de prueba',
        fechaDeAlta: new Date('2023-01-01'),
        usuarioCarga: 'usuarioTest',
    };

    const cargosArrayMock = [
        { id: 1, ...cargoDeInicioMock },
        { id: 2, cargo: 'Otro Cargo', descripcion: 'Otra descripción', fechaDeAlta: new Date('2023-01-02'), usuarioCarga: 'usuario2' },
    ];

    const mockCargosModel: any = {
        create: jest.fn().mockResolvedValue(cargoDeInicioMock),
        find: jest.fn().mockResolvedValue(cargosArrayMock),
        findByIdAndUpdate: jest.fn().mockResolvedValue({ id: 1, ...cargoDeInicioMock }),
        // Se reemplaza findByIdAndRemove por findByIdAndDelete para cumplir con el tipado
        findByIdAndDelete: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CargosdeinicioService,
                {
                    provide: getModelToken('Cargosdeinicio'),
                    useValue: mockCargosModel,
                },
            ],
        }).compile();

        service = module.get<CargosdeinicioService>(CargosdeinicioService);
        model = module.get<Model<Cargosdeinicio>>(getModelToken('Cargosdeinicio'));
    });

    it('debería estar definido el service', () => {
        expect(service).toBeDefined();
    });

    describe('crear', () => {
        it('debería crear un cargo de inicio', async () => {
            const resultado = await service.crear(cargoDeInicioMock);
            expect(resultado).toEqual(cargoDeInicioMock);
            expect(model.create).toHaveBeenCalledWith(cargoDeInicioMock);
        });
    });

    describe('obtenerTodos', () => {
        it('debería retornar todos los cargos de inicio', async () => {
            const resultado = await service.obtenerTodos();
            expect(resultado).toEqual(cargosArrayMock);
            expect(model.find).toHaveBeenCalled();
        });
    });

    describe('actualizar', () => {
        it('debería actualizar un cargo de inicio', async () => {
            const id = 1;
            const updateData = { cargo: 'Cargo Actualizado' };
            const resultado = await service.actualizar(id, updateData);
            expect(resultado).toEqual({ id, ...cargoDeInicioMock });
            // Se castea a any para evitar conflictos de tipado en la firma de findByIdAndUpdate
            expect((model.findByIdAndUpdate as any)).toHaveBeenCalledWith(id, updateData, { new: true });
        });
    });

    describe('eliminar', () => {
        it('debería eliminar un cargo de inicio', async () => {
            const id = 1;
            const resultado = await service.eliminar(id);
            expect(resultado).toBeUndefined();
            // Se usa findByIdAndDelete en lugar de findByIdAndRemove
            expect((model.findByIdAndDelete as any)).toHaveBeenCalledWith(id);
        });
    });
});
