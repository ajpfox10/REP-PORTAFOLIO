import { Test, TestingModule } from '@nestjs/testing';
import { CertificadosService } from './certificados.service';
import { Certificados } from './certificados.model';
import { getModelToken } from '@nestjs/sequelize';
import { NotFoundException } from '@nestjs/common';
import '../../test/utils/test-setup';

describe('CertificadosService', () => {
    let service: CertificadosService;
    let modelMock: any;

    const certificadoMock = {
        id: 1,
        nombre: 'Certificado A',
        usuarioCarga: 'admin',
        update: jest.fn().mockResolvedValue({
            id: 1,
            nombre: 'Certificado Actualizado',
            usuarioCarga: 'admin',
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        modelMock = {
            create: jest.fn().mockResolvedValue(certificadoMock),
            findAll: jest.fn().mockResolvedValue([certificadoMock]),
            findByPk: jest.fn().mockResolvedValue(certificadoMock),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CertificadosService,
                { provide: getModelToken(Certificados), useValue: modelMock },
            ],
        }).compile();

        service = module.get<CertificadosService>(CertificadosService);
    });

    it('debería crear un certificado', async () => {
        const dto = { nombre: 'Certificado A', usuarioCarga: 'admin' };
        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toEqual(certificadoMock);
    });

    it('debería obtener todos los certificados', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([certificadoMock]);
        expect(modelMock.findAll).toHaveBeenCalled();
    });

    it('debería obtener un certificado por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual(certificadoMock);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
    });

    it('debería lanzar NotFoundException si el certificado no existe', async () => {
        modelMock.findByPk.mockResolvedValue(null);
        await expect(service.obtenerPorId(999)).rejects.toThrow(NotFoundException);
    });

    it('debería actualizar un certificado', async () => {
        const dto = { nombre: 'Certificado Actualizado' };
        const fakeCert = {
            id: 1,
            update: jest.fn().mockResolvedValue({ id: 1, ...dto, usuarioCarga: 'admin' }),
        };
        modelMock.findByPk.mockResolvedValue(fakeCert);

        const result = await service.actualizar(1, dto);
        expect(fakeCert.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto, usuarioCarga: 'admin' });
    });

    it('debería eliminar un certificado', async () => {
        const fakeCert = {
            id: 1,
            destroy: jest.fn().mockResolvedValue(undefined),
        };
        modelMock.findByPk.mockResolvedValue(fakeCert);

        await expect(service.eliminar(1)).resolves.toBeUndefined();
        expect(fakeCert.destroy).toHaveBeenCalled();
    });
});

