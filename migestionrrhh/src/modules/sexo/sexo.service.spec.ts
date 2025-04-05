// Test unitario para sexo.service}}
import { Test, TestingModule } from '@nestjs/testing';
import { SexoService } from './sexo.service';
import { getModelToken } from '@nestjs/sequelize';
import { Sexo } from './sexo.model';
import { ActualizarSexoDto } from './dto/actualizar-sexo.dto';

describe('SexoService', () => {
    let service: SexoService;

    const mockModel = {
        findAll: jest.fn(() => Promise.resolve([
            { id: 1, descripcion: 'Masculino', usuarioCarga: 'admin' },
        ])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                descripcion: 'Masculino',
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
                SexoService,
                {
                    provide: getModelToken(Sexo),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<SexoService>(SexoService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('obtenerTodos() debe retornar todos los registros', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([
            { id: 1, descripcion: 'Masculino', usuarioCarga: 'admin' },
        ]);
    });

    it('obtenerPorId() debe retornar un registro específico', async () => {
        const result = await service.obtenerPorId(1);
        expect(result?.id).toBe(1);
        expect(result?.descripcion).toBe('Masculino');
    });

    it('actualizar() debe modificar un registro de sexo', async () => {
        const dto: ActualizarSexoDto = {
            nombre: 'Femenino',
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result.id).toBe(1);
        expect(result.descripcion).toBe('Masculino');
    });

    it('eliminar() debe eliminar un registro', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
