import { Test, TestingModule } from '@nestjs/testing';
import { TblarchivosController } from './tblarchivos.controller';
import { TblarchivosService } from './tblarchivos.service';
import { JwtModule } from '@nestjs/jwt';
import '../../test/utils/test-setup';  // Ajusta la ruta según corresponda

describe('TblarchivosController', () => {
    let controller: TblarchivosController;
    let service: TblarchivosService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [
                JwtModule.register({ secret: 'your_secret_key', signOptions: { expiresIn: '1h' } }), // Añadir JwtModule con configuración
            ],
            controllers: [TblarchivosController],
            providers: [
                {
                    provide: TblarchivosService,
                    useValue: {
                        crear: jest.fn().mockResolvedValue({ id: 1 }),
                        obtenerTodos: jest.fn().mockResolvedValue([]),
                        obtenerPorId: jest.fn().mockResolvedValue({ id: 1 }),
                        actualizar: jest.fn().mockResolvedValue({ id: 1 }),
                        eliminar: jest.fn().mockResolvedValue({ deleted: true }),
                    },
                },
            ],
        }).compile();

        controller = module.get<TblarchivosController>(TblarchivosController);
        service = module.get<TblarchivosService>(TblarchivosService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('debería crear un archivo', async () => {
        const dto = { nombre: 'archivo.txt' } as any;
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1 });
        expect(service.crear).toHaveBeenCalledWith(dto);
    });

    it('debería obtener todos los archivos', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([]);
    });

    it('debería obtener un archivo por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual({ id: 1 });
    });

    it('debería actualizar un archivo', async () => {
        const dto = { nombre: 'actualizado.txt' } as any;
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1 });
    });

    it('debería eliminar un archivo', async () => {
        const dto = { motivo: 'duplicado' } as any;
        const result = await controller.eliminar(1, dto);
        expect(result).toEqual({ deleted: true });
    });
});
