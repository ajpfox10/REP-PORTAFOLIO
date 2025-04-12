import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { ReparticionesController } from './reparticiones.controller';
import { ReparticionesService } from './reparticiones.service';
import { JwtAuthGuard } from '@auth/guards/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard } from '@auth/guards/roles.guard';
import { CrearReparticionesDto } from './dto/crear-reparticiones.dto';
import { ActualizarReparticionesDto } from './dto/actualizar-reparticiones.dto';

// Mock de una repartición
const mockReparticion = {
    id: 1,
    codigo: 'REP001',
    descripcion: 'Descripción de prueba',
    abreviatura: 'RP',
    fechaDeAlta: new Date('2023-01-01'),
    usuarioCarga: 'testuser'
};

// Mocks para guards
const mockJwtAuthGuard = {
    canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        req.user = { id: 1, username: 'testuser', roles: ['admin'] };
        return true;
    }
};

const mockRolesGuard = {
    canActivate: jest.fn(() => true)
};

// Mocks para decoradores
jest.mock('@auth/decoradores/user.decorator', () => ({
    User: () => (target: any, key: string, index: number) => ({
        id: 1,
        username: 'testuser',
        roles: ['admin']
    })
}));

jest.mock('@auth/decoradores/roles.decorator', () => ({
    Roles: (...roles: string[]) => (target: any, key?: string | symbol, descriptor?: PropertyDescriptor) => {
        if (descriptor) return descriptor;
    }
}));

describe('ReparticionesController', () => {
    let controller: ReparticionesController;
    let service: jest.Mocked<ReparticionesService>;

    beforeEach(async () => {
        const serviceMock: Partial<ReparticionesService> = {
            obtenerTodos: jest.fn().mockResolvedValue([mockReparticion]),
            obtenerPorId: jest.fn().mockResolvedValue(mockReparticion),
            crear: jest.fn().mockImplementation(dto =>
                Promise.resolve({ ...mockReparticion, ...dto, id: 2 })
            ),
            actualizar: jest.fn().mockImplementation((id, dto) =>
                Promise.resolve({ ...mockReparticion, id, ...dto })
            ),
            eliminar: jest.fn().mockResolvedValue(true)
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ReparticionesController],
            providers: [
                {
                    provide: ReparticionesService,
                    useValue: serviceMock
                },
                {
                    provide: JwtService,
                    useValue: {
                        sign: jest.fn(),
                        verify: jest.fn()
                    }
                }
            ]
        })
            .overrideGuard(JwtAuthGuard)
            .useValue(mockJwtAuthGuard)
            .overrideGuard(RolesGuard)
            .useValue(mockRolesGuard)
            .compile();

        controller = module.get<ReparticionesController>(ReparticionesController);
        service = module.get(ReparticionesService) as jest.Mocked<ReparticionesService>;
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    describe('GET /reparticiones', () => {
        it('debería retornar todas las reparticiones', async () => {
            const result = await controller.obtenerTodos();
            expect(result).toEqual([mockReparticion]);
            expect(service.obtenerTodos).toHaveBeenCalled();
        });
    });

    describe('GET /reparticiones/:id', () => {
        it('debería retornar una repartición específica', async () => {
            const result = await controller.obtenerPorId(1);
            expect(result).toEqual(mockReparticion);
            expect(service.obtenerPorId).toHaveBeenCalledWith(1);
        });
    });

    describe('POST /reparticiones', () => {
        it('debería crear una nueva repartición', async () => {
            const createDto: CrearReparticionesDto = {
                codigo: 'REP002',
                descripcion: 'Nueva repartición',
                abreviatura: 'NR'
            };

            const result = await controller.crear(createDto);
            expect(result).toEqual(expect.objectContaining(createDto));
            expect(service.crear).toHaveBeenCalledWith(createDto);
        });
    });

    describe('PUT /reparticiones/:id', () => {
        it('debería actualizar una repartición existente', async () => {
            const updateDto: ActualizarReparticionesDto = {
                descripcion: 'Descripción actualizada'
            };

            const result = await controller.actualizar(1, updateDto);
            expect(result.descripcion).toBe(updateDto.descripcion);
            expect(service.actualizar).toHaveBeenCalledWith(1, updateDto);
        });
    });

    describe('DELETE /reparticiones/:id', () => {
        it('debería eliminar una repartición', async () => {
            await controller.eliminar(1);
            expect(service.eliminar).toHaveBeenCalledWith(1);
        });
    });
});