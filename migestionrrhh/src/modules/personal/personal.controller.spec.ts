// Test unitario para personal.controller
import { Test, TestingModule } from '@nestjs/testing';
import { PersonalController } from './personal.controller';
import { PersonalService } from './personal.service';
import { CreatePersonalDto } from './dto/personal.dto';
import { ActualizarPersonalDto } from './dto/actualizar-personal.dto';

describe('PersonalController', () => {
    let controller: PersonalController;
    let service: PersonalService;

    const mockService = {
        crear: jest.fn(dto => ({ CODIGOCLI: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ CODIGOCLI: 1, nombre: 'Juan' }]),
        obtenerPorId: jest.fn(id => ({ CODIGOCLI: id, nombre: 'Juan' })),
        actualizar: jest.fn((id, dto) => ({ CODIGOCLI: id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PersonalController],
            providers: [{ provide: PersonalService, useValue: mockService }],
        }).compile();

        controller = module.get<PersonalController>(PersonalController);
        service = module.get<PersonalService>(PersonalService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el personal creado', () => {
        const dto: CreatePersonalDto = {
            nombre: 'Juan',
            apellido: 'Pérez',
            dni: '12345678',
            sexo: 'Masculino',
            cargo: 'Operario',
            fechaNacimiento: new Date('1990-01-01'),
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ CODIGOCLI: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los registros de personal', () => {
        expect(controller.obtenerTodos()).toEqual([{ CODIGOCLI: 1, nombre: 'Juan' }]);
    });

    it('obtenerPorId() debe retornar un registro de personal por ID', () => {
        expect(controller.obtenerPorId(1)).toEqual({ CODIGOCLI: 1, nombre: 'Juan' });
    });

    it('actualizar() debe retornar el personal actualizado', () => {
        const dto: ActualizarPersonalDto = {
            nombre: 'Carlos',
            usuarioCarga: 'editor',
        };
        expect(controller.actualizar(1, dto)).toEqual({ CODIGOCLI: 1, ...dto });
    });

    it('eliminar() debe confirmar la eliminación', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
