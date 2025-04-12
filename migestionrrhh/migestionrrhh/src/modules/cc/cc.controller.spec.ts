import { Test, TestingModule } from '@nestjs/testing';
import { CcController } from './cc.controller';
import { CcService } from './cc.service';
import { CrearCcDto } from './dto/cc.dto';
import { ActualizarCcDto } from './dto/actualizar-cc.dto';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import '../../test/utils/test-setup';  // Ajusta la ruta según corresponda

describe('CcController', () => {
    let controller: CcController;
    let service: CcService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, nombre: 'CC1' }]),
        obtenerPorId: jest.fn(id => ({ id, nombre: 'CC Detalle' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ success: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CcController],
            providers: [
                { provide: CcService, useValue: mockService },
                { provide: JwtService, useValue: { sign: () => 'token' } },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({ canActivate: () => true }) // ✅ mockea el guard para no lanzar error
            .compile();

        controller = module.get<CcController>(CcController);
        service = module.get<CcService>(CcService);
    });

    it('debería crear una CC', async () => {
        const dto: CrearCcDto = { nombre: 'Nuevo CC', fechaDeAlta: new Date(), usuarioCarga: 'admin' };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(mockService.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todas las CC', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'CC1' }]);
        expect(mockService.obtenerTodos).toHaveBeenCalled();
    });

    it('debería obtener CC por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual({ id: 1, nombre: 'CC Detalle' });
        expect(mockService.obtenerPorId).toHaveBeenCalledWith(1);
    });

    it('debería actualizar una CC', async () => {
        const dto: ActualizarCcDto = { nombre: 'Modificado' };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
        expect(mockService.actualizar).toHaveBeenCalledWith(1, dto);
    });

    it('debería eliminar una CC', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ success: true });
        expect(mockService.eliminar).toHaveBeenCalledWith(1);
    });
});
