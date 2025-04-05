// Test unitario para certificados.service
import { Test, TestingModule } from '@nestjs/testing';
import { CertificadosService } from './certificados.service';
import { getModelToken } from '@nestjs/sequelize';
import { Certificados } from './certificados.model';
import { CrearCertificadosDto } from './dto/certificados.dto';
import { ActualizarCertificadoDto } from './dto/actualizar-certificado.dto';

describe('CertificadosService', () => {
    let service: CertificadosService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Certificado A' }])),
        findByPk: jest.fn(id => Promise.resolve({ id, nombre: 'Certificado A' })),
        update: jest.fn((dto, options) => Promise.resolve([1])),
        destroy: jest.fn(() => Promise.resolve(1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CertificadosService,
                {
                    provide: getModelToken(Certificados),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<CertificadosService>(CertificadosService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar un certificado creado', async () => {
        const dto: CrearCertificadosDto = {
            nombre: 'Certificado A',
            fechaDeAlta: new Date('2024-03-31'),
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los certificados', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Certificado A' }]);
    });

    it('obtenerPorId() debe retornar un certificado específico', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'Certificado A' });
    });

    it('actualizar() debe retornar el resultado de la actualización', async () => {
        const dto: ActualizarCertificadoDto = {
            nombre: 'Certificado Actualizado',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toEqual([1]);
    });

    it('eliminar() debe retornar éxito al eliminar', async () => {
        const result = await service.eliminar(1);
        expect(result).toEqual(1);
    });
});
