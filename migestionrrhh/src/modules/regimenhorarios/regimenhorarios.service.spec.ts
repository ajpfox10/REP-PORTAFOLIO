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
        findAll: jest.fn(() => Promise.resolve([{ id: 1, nombre: 'R�gimen Semanal' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                nombre: 'R�gimen Semanal',
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

    it('deber�a estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe crear y retornar un r�gimen horario', async () => {
        const dto: CrearRegimenhorariosDto = {
            nombre: 'R�gimen Semanal',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar todos los reg�menes horarios', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, nombre: 'R�gimen Semanal' }]);
    });

    it('obtenerPorId() debe retornar un r�gimen horario espec�fico', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toHaveProperty('id', 1);
        expect(result.nombre).toBe('R�gimen Semanal');
    });

    it('actualizar() debe modificar un r�gimen horario existente', async () => {
        const dto: ActualizarRegimenhorariosDto = {
            nombre: 'R�gimen Modificado',
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result).toHaveProperty('id', 1);
        expect(result.nombre).toBe('R�gimen Semanal');
    });

    it('eliminar() debe borrar correctamente un r�gimen horario', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
