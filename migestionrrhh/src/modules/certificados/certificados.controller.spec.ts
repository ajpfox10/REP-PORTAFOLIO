// Test unitario para certificados.controller
import { Test, TestingModule } from '@nestjs/testing';
import { CertificadosController } from './certificados.controller';
import { CertificadosService } from './certificados.service';
import { CrearCertificadosDto } from './dto/certificados.dto';
import { ActualizarCertificadoDto } from './dto/actualizar-certificado.dto';

describe('CertificadosController', () => {
    let controller: CertificadosController;
    let service: CertificadosService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'Certificado A' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'Certificado A' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CertificadosController],
            providers: [{ provide: CertificadosService, useValue: mockService }],
        }).compile();

        controller = module.get<CertificadosController>(CertificadosController);
        service = module.get<CertificadosService>(CertificadosService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar un certificado creado', () => {
        const dto: CrearCertificadosDto = {
            nombre: 'Certificado A',
            fechaDeAlta: new Date('2024-03-31'),
            usuarioCarga: 'admin',
        };
        expect(controller.crear(dto)).toEqual({ id: 1, ...dto });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('obtenerTodos() debe retornar todos los certificados', () => {
        expect(controller.obtenerTodos()).toEqual([{ id: 1, nombre: 'Certificado A' }]);
    });

    it('obtenerPorId() debe retornar un certificado específico', () => {
        expect(controller.obtenerPorId(1)).toEqual({ id: 1, nombre: 'Certificado A' });
    });

    it('actualizar() debe retornar el certificado actualizado', () => {
        const dto: ActualizarCertificadoDto = {
            nombre: 'Certificado Actualizado',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        expect(controller.actualizar(1, dto)).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe retornar confirmación de borrado', () => {
        expect(controller.eliminar(1)).toEqual({ deleted: true });
    });
});
