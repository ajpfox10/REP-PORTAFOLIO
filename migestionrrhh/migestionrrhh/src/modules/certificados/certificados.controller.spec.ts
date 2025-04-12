import '../../test/utils/test-setup'; // ✅ Mocks globales de JwtAuthGuard y RolesGuard

import { Test, TestingModule } from '@nestjs/testing';
import { CertificadosController } from './certificados.controller';
import { CertificadosService } from './certificados.service';
import { CrearCertificadosDto } from './dto/certificados.dto';
import { ActualizarCertificadoDto } from './dto/actualizar-certificado.dto';

describe('CertificadosController', () => {
    let controller: CertificadosController;
    let service: CertificadosService;

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
            controllers: [CertificadosController],
            providers: [
                { provide: CertificadosService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<CertificadosController>(CertificadosController);
        service = module.get<CertificadosService>(CertificadosService);
    });

    it('debería crear un certificado', async () => {
        const dto: CrearCertificadosDto = {
            nombre: 'Certificado A',
            usuarioCarga: 'admin',
        };

        const resultadoEsperado = { id: 1, ...dto };
        mockService.crear.mockResolvedValue(resultadoEsperado);

        const result = await controller.crear(dto);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todos los certificados', async () => {
        const resultadoEsperado = [
            { id: 1, nombre: 'Certificado A', usuarioCarga: 'admin' },
        ];

        mockService.obtenerTodos.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerTodos();
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener un certificado por id', async () => {
        const resultadoEsperado = {
            id: 1,
            nombre: 'Certificado A',
            usuarioCarga: 'admin',
        };

        mockService.obtenerPorId.mockResolvedValue(resultadoEsperado);

        const result = await controller.obtenerPorId(1);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar un certificado', async () => {
        const id = 1;
        const dto: ActualizarCertificadoDto = { nombre: 'Certificado Actualizado' };
        const resultadoEsperado = {
            id,
            ...dto,
            usuarioCarga: 'admin',
        };

        mockService.actualizar.mockResolvedValue(resultadoEsperado);

        const result = await controller.actualizar(id, dto);
        expect(result).toEqual(resultadoEsperado);
        expect(mockService.actualizar).toHaveBeenCalledWith(id, dto);
    });

    it('debería eliminar un certificado', async () => {
        const id = 1;
        mockService.eliminar.mockResolvedValue(undefined);

        const result = await controller.eliminar(id);
        expect(result).toBeUndefined();
        expect(mockService.eliminar).toHaveBeenCalledWith(id);
    });
});
