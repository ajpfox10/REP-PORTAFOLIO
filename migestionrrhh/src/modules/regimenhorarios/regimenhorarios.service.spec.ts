// Test unitario para regimenhorarios.service
import { Test, TestingModule } from '@nestjs/testing';
import { RegimenhorariosService } from './regimenhorarios.service';
import { getModelToken } from '@nestjs/sequelize';
import { Regimenhorarios } from './regimenhorarios.model';
import { CrearRegimenhorariosDto } from './dto/crear-regimenhorarios.dto';
import { ActualizarRegimenhorariosDto } from './dto/actualizar-regimenhorarios.dto';

describe('RegimenhorariosService', () => {
    let service: RegimenhorariosService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'Régimen Semanal' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                nombre: 'Régimen Semanal',
                descripcion: 'Turnos de lunes a viernes',
                fechaDeAlta: new Date(),
                usuarioCarga: 'admin',
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true),
            }),
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RegimenhorariosService,
                {
                    provide: getModelToken(Regimenhorarios),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<RegimenhorariosService>(RegimenhorariosService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe crear y retornar un régimen horario', async () => {
        const dto: CrearRegimenhorariosDto = {
            nombre: 'Régimen Semanal',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los regímenes horarios', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'Régimen Semanal' }]);
    });

    it('obtenerPorId() debe retornar un régimen horario específico', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toHaveProperty('id', 1);
        expect(result.nombre).toBe('Régimen Semanal');
    });

    it('actualizar() debe modificar un régimen horario existente', async () => {
        const dto: ActualizarRegimenhorariosDto = {
            nombre: 'Régimen Modificado',
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toHaveProperty('id', 1);
        expect(result.nombre).toBe('Régimen Semanal');
    });

    it('eliminar() debe borrar correctamente un régimen horario', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
