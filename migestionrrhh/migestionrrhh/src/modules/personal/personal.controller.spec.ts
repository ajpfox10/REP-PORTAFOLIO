import '../../test/utils/test-setup'; // 👈 Mock global de guards y JwtService

import { Test, TestingModule } from '@nestjs/testing';
import { PersonalController } from './personal.controller';
import { PersonalService } from './personal.service';
import { CreatePersonalDto } from './dto/personal.dto';
import { ActualizarPersonalDto } from './dto/actualizar-personal.dto';

describe('PersonalController', () => {
    let controller: PersonalController;
    let service: PersonalService;

    const mockService = {
        crear: jest.fn(),
        obtenerTodos: jest.fn(),
        obtenerPorId: jest.fn(),
        actualizar: jest.fn(),
        eliminar: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [PersonalController],
            providers: [
                { provide: PersonalService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<PersonalController>(PersonalController);
        service = module.get<PersonalService>(PersonalService);
    });

    it('debería crear un personal', async () => {
        const dto: CreatePersonalDto = {
            nombre: 'Juan',
            apellido: 'Pérez',
            dni: '12345678',
            sexo: 'Masculino',
            cargo: 'Operario',
            usuarioCarga: 'admin',
        };

        const resultadoEsperado = { id: 1, ...dto };
        mockService.crear.mockResolvedValue(resultadoEsperado);

        const result = await controller.crear(dto);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todos los registros', async () => {
        const resultadoEsperado = [
            { id: 1, nombre: 'Juan', apellido: 'Pérez', usuarioCarga: 'admin' },
        ];
        mockService.obtenerTodos.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerTodos();
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener un personal por ID', async () => {
        const resultadoEsperado = {
            id: 1,
            nombre: 'Juan',
            apellido: 'Pérez',
            usuarioCarga: 'admin',
        };
        mockService.obtenerPorId.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar un personal', async () => {
        const dto: ActualizarPersonalDto = {
            nombre: 'Juan Actualizado',
        };
        const resultadoEsperado = {
            id: 1,
            ...dto,
            usuarioCarga: 'admin',
        };

        mockService.actualizar.mockResolvedValue(resultadoEsperado);

        const result = await controller.actualizar(1, dto);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar un personal', async () => {
        mockService.eliminar.mockResolvedValue(undefined);

        const result = await controller.eliminar(1);
        expect(result).toBeUndefined();
        expect(mockService.eliminar).toHaveBeenCalledWith(1);
    });
});
