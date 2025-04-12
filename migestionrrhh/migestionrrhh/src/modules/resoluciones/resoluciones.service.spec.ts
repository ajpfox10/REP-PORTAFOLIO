import { Test, TestingModule } from '@nestjs/testing';
import { ResolucionesService } from './resoluciones.service';
import { getModelToken } from '@nestjs/sequelize';
import { Resolucion } from './resoluciones.model';
import { CrearResolucionDto } from './dto/crear-resolucion.dto';
import { ActualizarResolucionDto } from './dto/actualizar-resolucion.dto';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';

describe('ResolucionesService', () => {
    let service: ResolucionesService;
    let modelMock: any;

    const mockInstance = {
        id: 1,
        resolucion: 'Resolución 123',
        usuarioCarga: 'admin',
        fechaDeAlta: new Date(),
        update: jest.fn().mockResolvedValue({ id: 1, resolucion: 'Resolución modificada', usuarioCarga: 'editor' }),
        destroy: jest.fn().mockResolvedValue(true),
    };

    beforeEach(async () => {
        modelMock = {
            create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
            findAll: jest.fn(() => Promise.resolve([mockInstance])),
            findByPk: jest.fn(() => Promise.resolve(mockInstance)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ResolucionesService,
                {
                    provide: getModelToken(Resolucion),
                    useValue: modelMock,
                },
            ],
        }).compile();

        service = module.get<ResolucionesService>(ResolucionesService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar la resolución creada', async () => {
        const dto = {
            resolucion: 'Resolución 123',
            usuarioCarga: 'admin',
        };

        const mockResult = {
            id: 1,
            ...dto,
            fechaDeAlta: new Date(),
        };

        modelMock.create.mockResolvedValue(mockResult);

        const result = await service.crear(dto);

        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });

        expect(result).toEqual(mockResult);
    });



    it('obtenerTodas() debe retornar todas las resoluciones', async () => {
        const result = await service.obtenerTodas();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual([mockInstance]);
    });

    it('buscarPorId() debe retornar una resolución por ID', async () => {
        const result = await service.buscarPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result?.id).toBe(1);
    });

    it('buscarPorId() debe lanzar NotFoundException si no existe', async () => {
        modelMock.findByPk.mockResolvedValueOnce(null);
        await expect(service.buscarPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('actualizar() debe modificar la resolución', async () => {
        const dto: ActualizarResolucionDto = {
            resolucion: 'Resolución modificada',
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(mockInstance.update).toHaveBeenCalledWith(dto);
        expect(result?.id).toBe(1);
        expect(result?.resolucion).toBe('Resolución modificada');
    });

    it('eliminar() debe ejecutar correctamente la eliminación', async () => {
        const result = await service.eliminar(1);
        expect(mockInstance.destroy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});
