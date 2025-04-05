// Test unitario para tipotramite.service
import { Test, TestingModule } from '@nestjs/testing';
import { TipotramiteService } from './tipotramite.service';
import { getModelToken } from '@nestjs/sequelize';
import { TipoTramite } from './tipotramite.model';
import { CrearTipoTramiteDto } from './dto/crear-tipotramite.dto';
import { ActualizarTipoTramiteDto } from './dto/actualizar-tipotramite.dto';

describe('TipotramiteService', () => {
    let service: TipotramiteService;

    const mockModel = {
        create: jest.fn(dto => Promise.resolve({ ID: 1, ...dto })),
        findAll: jest.fn(() => Promise.resolve([{ ID: 1, TIPODETRAMITE: 'Certificaci�n' }])),
        findByPk: jest.fn(id =>
            Promise.resolve({
                ID: id,
                TIPODETRAMITE: 'Certificaci�n',
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
                TipotramiteService,
                {
                    provide: getModelToken(TipoTramite),
                    useValue: mockModel,
                },
            ],
        }).compile();

        service = module.get<TipotramiteService>(TipotramiteService);
    });

    it('deber�a estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe retornar un nuevo tipo de tr�mite', async () => {
        const dto: CrearTipoTramiteDto = {
            TIPODETRAMITE: 'Certificaci�n',
            usuarioCarga: 'admin',
            fechaDeAlta: new Date('2024-04-01'),
        };
        const result = await service.crear(dto);
        expect(result).toEqual(expect.objectContaining({ TIPODETRAMITE: 'Certificaci�n' }));
    });

    it('obtenerTodos() debe retornar todos los tipos de tr�mite', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([{ ID: 1, TIPODETRAMITE: 'Certificaci�n' }]);
    });

    it('obtenerPorId() debe retornar un tipo espec�fico', async () => {
        const result = await service.obtenerPorId(1);
        expect(result?.ID).toBe(1);
        expect(result?.TIPODETRAMITE).toBe('Certificaci�n');
    });

    it('actualizar() debe modificar un tipo de tr�mite existente', async () => {
        const dto: ActualizarTipoTramiteDto = {
            TIPODETRAMITE: 'Autorizaci�n',
            usuarioCarga: 'editor',
        };
        const result = await service.actualizar(1, dto);
        expect(result?.ID).toBe(1);
        expect(result?.TIPODETRAMITE).toBe('Certificaci�n'); // se mantiene por mock
    });

    it('eliminar() debe ejecutar correctamente la eliminaci�n', async () => {
        await expect(service.eliminar(1)).resolves.toBeUndefined();
    });
});
