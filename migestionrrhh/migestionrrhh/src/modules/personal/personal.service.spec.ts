import { Test, TestingModule } from '@nestjs/testing';
import { PersonalService } from './personal.service';
import { Personal } from './personal.model';
import { getModelToken } from '@nestjs/sequelize';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';

describe('PersonalService', () => {
    let service: PersonalService;
    let modelMock: any;

    const personalDto = {
        apellido: 'Pérez',
        cargo: 'Operario',
        dni: '12345678',
        fechaNacimiento: new Date('1990-01-01'),
        nombre: 'Juan',
        sexo: 'Masculino',
        usuarioCarga: 'admin',
    };

    const personalMock = {
        CODIGOCLI: 1,
        ...personalDto,
        fechaDeAlta: new Date(),
        update: jest.fn().mockResolvedValue({
            CODIGOCLI: 1,
            ...personalDto,
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        modelMock = {
            create: jest.fn().mockResolvedValue(personalMock),
            findAll: jest.fn().mockResolvedValue([personalMock]),
            findByPk: jest.fn().mockResolvedValue(personalMock),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PersonalService,
                { provide: getModelToken(Personal), useValue: modelMock },
            ],
        }).compile();

        service = module.get<PersonalService>(PersonalService);
    });

    it('debería crear y retornar un registro de personal', async () => {
        const dto = { ...personalDto };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toMatchObject({ CODIGOCLI: 1, ...dto });
    });

    it('debería obtener todos los registros de personal', async () => {
        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([personalMock]);
    });

    it('debería obtener un registro de personal por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(personalMock);
    });

    it('debería lanzar NotFoundException si el registro no existe', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('debería actualizar los datos de personal', async () => {
        const updateDto = { nombre: 'Juan Actualizado' };
        modelMock.findByPk.mockResolvedValue(personalMock);
        const result = await service.actualizar(1, updateDto);
        expect(personalMock.update).toHaveBeenCalledWith(updateDto);
        expect(result.CODIGOCLI).toBe(1);
    });

    it('debería eliminar un registro de personal correctamente', async () => {
        modelMock.findByPk.mockResolvedValue(personalMock);
        const result = await service.eliminar(1);
        expect(personalMock.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
