// Test unitario para pedidos.service
import { Test, TestingModule } from '@nestjs/testing';
import { PedidosService } from './pedidos.service';
import { getModelToken } from '@nestjs/sequelize';
import { Pedidos } from './pedidos.model';
import { CrearPedidosDto } from './dto/crear-pedidos.dto';
import { ActualizarPedidosDto } from './dto/actualizar-pedidos.dto';

describe('PedidosService', () => {
    let service: PedidosService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Pedido 1' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                nombre: 'Pedido 1',
                descripcion: 'Desc',
                usuarioCarga: 'admin',
                fechaDeAlta: new Date(),
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
            }),
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PedidosService,
                {
                    provide: getModelToken(Pedidos),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<PedidosService>(PedidosService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe crear y retornar un pedido', async () => {
        const dto: CrearPedidosDto = {
            nombre: 'Nuevo Pedido',
            fechaDeAlta: new Date('2024-04-01'),
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar lista de pedidos', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Pedido 1' }]);
    });

    it('obtenerPorId() debe retornar un pedido por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result.id).toBe(1);
        expect(result.nombre).toBe('Pedido 1');
    });

    it('actualizar() debe modificar un pedido existente', async () => {
        const dto: ActualizarPedidosDto = {
            nombre: 'Pedido Modificado',
            fechaDeAlta: new Date('2024-04-02'),
            usuarioCarga: 'tecnico',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toMatchObject({ id: 1, nombre: 'Pedido 1' });
    });

    it('eliminar() debe ejecutar el borrado correctamente', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
