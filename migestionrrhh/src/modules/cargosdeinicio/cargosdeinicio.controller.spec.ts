import { Test, TestingModule } from '@nestjs/testing';
import { CargosdeinicioController } from './cargosdeinicio.controller';
import { CargosdeinicioService } from './cargosdeinicio.service';
import { CrearCargosDeInicioDto } from './dto/cargosdeinicio.dto';
import { ActualizarCargosDeInicioDto } from './dto/actualizar-cargosdeinicio.dto';
import { EliminarCargosdeinicioDto } from './dto/eliminar-cargosdeinicio.dto';

describe('CargosdeinicioController', () => {
    let controller: CargosdeinicioController;
    let service: CargosdeinicioService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CargosdeinicioController],
            providers: [
                {
                    provide: CargosdeinicioService,
                    useValue: {
                        crear: jest.fn(),
                        actualizar: jest.fn(),
                        eliminar: jest.fn(),
                        obtenerTodos: jest.fn(),
                    },
                },
            ],
        }).compile();

        controller = module.get<CargosdeinicioController>(CargosdeinicioController);
        service = module.get<CargosdeinicioService>(CargosdeinicioService);
    });

    it('deber�a estar definido el controller', () => {
        expect(controller).toBeDefined();
    });

    describe('crear', () => {
        it('deber�a crear un cargo de inicio', async () => {
            const dto: CrearCargosDeInicioDto = {
                cargo: 'Cargo de Prueba',
                descripcion: 'Descripci�n de prueba',
                fechaDeAlta: new Date('2023-01-01'),
                usuarioCarga: 'usuarioTest',
            };
            // Se castea a "any" para omitir propiedades internas de un documento real
            const resultadoEsperado = { id: 1, ...dto } as any;

            jest.spyOn(service, 'crear').mockResolvedValue(resultadoEsperado);

            expect(await controller.crear(dto)).toEqual(resultadoEsperado);
        });
    });

    describe('actualizar', () => {
        it('deber�a actualizar un cargo de inicio', async () => {
            const id = 1;
            const dto: ActualizarCargosDeInicioDto = {
                cargo: 'Cargo Actualizado',
                descripcion: 'Descripci�n actualizada'
            };
            const resultadoEsperado = { id, ...dto } as any;

            jest.spyOn(service, 'actualizar').mockResolvedValue(resultadoEsperado);

            // Se fusiona el id y el dto en un �nico objeto
            expect(await controller.actualizar({ id, ...dto })).toEqual(resultadoEsperado);
        });
    });

    describe('eliminar', () => {
        it('deber�a eliminar un cargo de inicio', async () => {
            const id = 1;
            const dto: EliminarCargosdeinicioDto = { id };
            jest.spyOn(service, 'eliminar').mockResolvedValue(undefined);

            // Se env�a un �nico objeto, fusionando el id y el dto (en este caso, el dto ya contiene el id)
            await expect(controller.eliminar({ id, ...dto })).resolves.toBeUndefined();
        });
    });

    describe('obtenerTodos', () => {
        it('deber�a retornar todos los cargos de inicio', async () => {
            const resultadoEsperado = [
                {
                    id: 1,
                    cargo: 'Cargo 1',
                    descripcion: 'Descripci�n 1',
                    fechaDeAlta: new Date('2023-01-01'),
                    usuarioCarga: 'usuario1',
                },
                {
                    id: 2,
                    cargo: 'Cargo 2',
                    descripcion: 'Descripci�n 2',
                    fechaDeAlta: new Date('2023-01-02'),
                    usuarioCarga: 'usuario2',
                },
            ] as any;

            jest.spyOn(service, 'obtenerTodos').mockResolvedValue(resultadoEsperado);

            expect(await controller.obtenerTodos()).toEqual(resultadoEsperado);
        });
    });
});
