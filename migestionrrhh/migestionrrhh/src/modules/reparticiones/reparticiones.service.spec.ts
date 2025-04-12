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

    // Mock de datos base para repartición
    const mockReparticionData = {
        id: 1,
        codigo: 'REP001',
        descripcion: 'Repartición de prueba',
        abreviatura: 'RP',
        fechaDeAlta: new Date(),
        usuarioCarga: 'testuser'
    };

    // Función para crear mock de instancia
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

        // Configuración del mock del modelo Sequelize
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
        it('debería actualizar una repartición existente', async () => {
            const updateDto: ActualizarReparticionesDto = {
                descripcion: 'Descripción actualizada'
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

        it('debería lanzar NotFoundException si no existe', async () => {
            const updateDto: ActualizarReparticionesDto = {
                descripcion: 'Descripción actualizada'
            };
            await expect(service.actualizar(999, updateDto)).rejects.toThrow(NotFoundException);
        });
    });

    // ... (resto de las pruebas)
});