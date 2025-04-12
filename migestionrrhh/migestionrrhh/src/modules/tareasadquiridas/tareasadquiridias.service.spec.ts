import { Test, TestingModule } from '@nestjs/testing';
import { TareasadquiridiasService } from './tareasadquiridias.service';
import { getModelToken } from '@nestjs/sequelize';
import { Tareasadquiridias } from './tareasadquiridias.model';
import { CrearTareasadquiridiasDto } from './dto/crear-tareasadquiridias.dto';

describe('TareasadquiridiasService', () => {
    let service: TareasadquiridiasService;
    const modelMock = {
        create: jest.fn((dto: any) => Promise.resolve({ id: 1, ...dto })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TareasadquiridiasService,
                {
                    provide: getModelToken(Tareasadquiridias),
                    useValue: modelMock,
                },
            ],
        }).compile();

        service = module.get<TareasadquiridiasService>(TareasadquiridiasService);
    });

    it('crear() debe retornar la tarea adquirida creada', async () => {
        const dto: CrearTareasadquiridiasDto = {
            agenteDeTrabajo: 'Juan Pérez',
            agente: 123,
            tareaAdquirida: 456,
            fechaDeAdquisicion: new Date('2024-04-01'),
            memo: 'Memo 01',
            estado: 1,
            fechaDeFinalizacion: new Date('2024-04-10'),
        };

        const result = await service.crear(dto, 'admin');

        // Validamos la respuesta del servicio
        expect(result).toMatchObject({
            ...dto,
            usuarioCarga: 'admin',
        });
        expect(result.fechaDeAlta).toBeInstanceOf(Date);

        // Validamos la llamada real al modelo
        expect(modelMock.create).toHaveBeenCalled();
        const [llamado] = modelMock.create.mock.calls[0];

        expect(llamado).toMatchObject({
            ...dto,
            usuarioCarga: 'admin',
        });
        expect(llamado.fechaDeAlta).toBeInstanceOf(Date);
    });
});

