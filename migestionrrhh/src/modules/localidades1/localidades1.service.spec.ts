// Test unitario para localidades1.service
import { Test, TestingModule } from '@nestjs/testing';
import { Localidades1Service } from './localidades1.service';
import { getModelToken } from '@nestjs/sequelize';
import { Localidades1 } from './localidades1.model';
import { CrearLocalidades1Dto } from './dto/crear-localidades1.dto';
import { ActualizarLocalidades1Dto } from './dto/actualizar_localidades1.dto';

describe('Localidades1Service', () => {
    let service: Localidades1Service;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Localidad A' }])),
        findByPk: jest.fn(id => Promise.resolve({ id, nombre: 'Localidad A' })),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Localidades1Service,
                {
                    provide: getModelToken(Localidades1),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<Localidades1Service>(Localidades1Service);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar una nueva localidad', async () => {
        const dto: CrearLocalidades1Dto = {
            nombre: 'Localidad Nueva',
            
            usuarioCarga: 'admin',
            descripcion: 'Una ciudad costera',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todas las localidades', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Localidad A' }]);
    });

    it('obtenerPorId() debe retornar la localidad correspondiente', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Localidad A' });
    });

    it('actualizar() debe retornar éxito en la modificación', async () => {
        const dto: ActualizarLocalidades1Dto = {
            nombre: 'Localidad Modificada',
            
            usuarioCarga: 'admin',
            descripcion: 'Una ciudad costera',
         
        };
        const result = await service.actualizar(1, dto);
        expect(result).toEqual([1]);
    });

    it('eliminar() debe retornar éxito en la eliminación', async () => {
        const result = await service.eliminar(1);
        expect(result).toEqual(1);
    });
});
