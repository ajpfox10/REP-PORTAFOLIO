// Test unitario para scaneardocumentacion.service
import { Test, TestingModule } from '@nestjs/testing';
import { ScaneardocumentacionService } from './scaneardocumentacion.service';
import { getModelToken } from '@nestjs/sequelize';
import { Scaneardocumentacion } from './scaneardocumentacion.model';
import { CrearScaneardocumentacionDto } from './dto/crear-scaneardocumentacion.dto';
import { ActualizarScaneardocumentacionDto } from './dto/actualizar-scaneardocumentacion.dto';

describe('ScaneardocumentacionService', () => {
    let service: ScaneardocumentacionService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ id: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ id: 1, descripcion: 'Doc', path: '/archivo.pdf' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                id,
                descripcion: 'Doc',
                path: '/archivo.pdf',
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
                ScaneardocumentacionService,
                {
                    provide: getModelToken(Scaneardocumentacion),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<ScaneardocumentacionService>(ScaneardocumentacionService);
    });

    it('debería estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe crear y retornar un documento', async () => {
        const dto: CrearScaneardocumentacionDto = {
            descripcion: 'Nuevo documento',
            path: '/nuevo.pdf',
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar la lista de documentos', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ id: 1, descripcion: 'Doc', path: '/archivo.pdf' }]);
    });

    it('obtenerPorId() debe retornar un documento por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result?.id).toBe(1);
        expect(result?.descripcion).toBe('Doc');
    });

    it('actualizar() debe actualizar un documento', async () => {
        const dto: ActualizarScaneardocumentacionDto = {
            descripcion: 'Documento actualizado',
            path: '/nuevo_path.pdf',
            usuarioCarga: 'otro',
        };
        const result = await service.actualizar(1, dto);
        expect(result?.id).toBe(1);
        expect(result?.descripcion).toBe('Doc');
    });

    it('eliminar() debe eliminar un documento sin errores', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
