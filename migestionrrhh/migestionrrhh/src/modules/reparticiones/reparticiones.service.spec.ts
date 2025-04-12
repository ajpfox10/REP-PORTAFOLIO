import { Test, TestingModule } from '@nestjs/testing';
import { ReparticionesService } from './reparticiones.service';
import { getModelToken } from '@nestjs/sequelize';
import { Reparticiones } from './reparticiones.model';
import { CrearReparticionesDto } from './dto/crear-reparticiones.dto';
import { ActualizarReparticionesDto } from './dto/actualizar-reparticiones.dto';
import { NotFoundException } from '@nestjs/common';

describe('ReparticionesService', () => {
    let service: ReparticionesService;
    let modelMock: typeof Reparticiones;

    // Mock de datos base para repartici�n
    const mockReparticionData = {
        id: 1,
        codigo: 'REP001',
        descripcion: 'Repartici�n de prueba',
        abreviatura: 'RP',
        fechaDeAlta: new Date(),
        usuarioCarga: 'testuser'
    };

    // Funci�n para crear mock de instancia
    const createMockInstance = (overrides = {}) => ({
        ...mockReparticionData,
        ...overrides,
        update: jest.fn().mockImplementation(dto => ({
            ...mockReparticionData,
            ...overrides,
            ...dto
        })),
        destroy: jest.fn().mockResolvedValue(true)
    });

    beforeEach(async () => {
        // Creamos mock de instancia para el caso exitoso
        const mockInstance = createMockInstance();

        // Configuraci�n del mock del modelo Sequelize
        modelMock = {
            findAll: jest.fn().mockResolvedValue([mockInstance]),
            findByPk: jest.fn((id) =>
                id === 1 ? Promise.resolve(mockInstance) : Promise.resolve(null)
            ),
            create: jest.fn().mockImplementation((dto) =>
                Promise.resolve({ ...mockReparticionData, ...dto, id: 2 })
            ),
        } as unknown as typeof Reparticiones;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ReparticionesService,
                {
                    provide: getModelToken(Reparticiones),
                    useValue: modelMock,
                },
            ],
        }).compile();

        service = module.get<ReparticionesService>(ReparticionesService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('actualizar()', () => {
        it('deber�a actualizar una repartici�n existente', async () => {
            const updateDto: ActualizarReparticionesDto = {
                descripcion: 'Descripci�n actualizada'
            };

            // Obtenemos el mock de instancia configurado en beforeEach
            const mockInstance = await modelMock.findByPk(1);

            // Type assertion para decirle a TypeScript que sabemos que no es null
            if (!mockInstance) {
                throw new Error('Mock instance should not be null in this test');
            }

            const result = await service.actualizar(1, updateDto);

            expect(result.descripcion).toBe(updateDto.descripcion);
            expect(mockInstance.update).toHaveBeenCalledWith(updateDto);
        });

        it('deber�a lanzar NotFoundException si no existe', async () => {
            const updateDto: ActualizarReparticionesDto = {
                descripcion: 'Descripci�n actualizada'
            };
            await expect(service.actualizar(999, updateDto)).rejects.toThrow(NotFoundException);
        });
    });

    // ... (resto de las pruebas)
});