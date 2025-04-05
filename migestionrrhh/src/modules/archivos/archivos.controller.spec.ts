// src/modules/archivos/tblarchivos.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { TblarchivosController } from './tblarchivos.controller';
import { TblarchivosService } from './tblarchivos.service';
import { CrearArchivoDto } from './dto/crear-archivo.dto';
import { ActualizarArchivoDto } from './dto/actualizar-archivo.dto';
import { EliminarArchivosDto } from './dto/eliminar-archivos.dto';
import { Tblarchivos } from './tblarchivos.model';

const mockArchivo = {
    id: 1,
    nombreArchivo: 'documento.pdf',
    tipoArchivo: 'pdf',
    ano: 2024,
    usuarioCarga: 'admin',
    fechaDeAlta: new Date(),
} as unknown as Tblarchivos; // Forzamos el tipado

describe('TblarchivosController', () => {
    let controller: TblarchivosController;
    let service: TblarchivosService;

    const mockService = {
        crear: jest.fn().mockResolvedValue(mockArchivo),
        obtenerTodos: jest.fn().mockResolvedValue([mockArchivo]),
        obtenerPorId: jest.fn().mockResolvedValue(mockArchivo),
        actualizar: jest.fn().mockResolvedValue([1, [mockArchivo]]),
        eliminar: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [TblarchivosController],
            providers: [
                {
                    provide: TblarchivosService,
                    useValue: mockService,
                },
            ],
        }).compile();

        controller = module.get<TblarchivosController>(TblarchivosController);
        service = module.get<TblarchivosService>(TblarchivosService);
    });

    it('debe estar definido', () => {
        expect(controller).toBeDefined();
    });

    describe('crear', () => {
        it('debe crear un archivo', async () => {
            const dto: CrearArchivoDto = {
                nombreArchivo: 'documento.pdf',
                tipoArchivo: 'pdf',
                ano: 2024,
                usuarioCarga: 'admin',
            };
            const result = await controller.crear(dto);
            expect(result).toEqual(mockArchivo);
            expect(service.crear).toHaveBeenCalledWith(dto);
        });
    });

    describe('obtenerTodos', () => {
        it('debe obtener todos los archivos', async () => {
            const result = await controller.obtenerTodos();
            expect(result).toEqual([mockArchivo]);
            expect(service.obtenerTodos).toHaveBeenCalled();
        });
    });

    describe('obtenerPorId', () => {
        it('debe obtener un archivo por ID', async () => {
            const result = await controller.obtenerPorId(1); // Se pasa número en lugar de string
            expect(result).toEqual(mockArchivo);
            expect(service.obtenerPorId).toHaveBeenCalledWith(1);
        });
    });

    describe('actualizar', () => {
        it('debe actualizar un archivo', async () => {
            const dto: ActualizarArchivoDto = { nombreArchivo: 'nuevo.pdf' };
            const result = await controller.actualizar(1, dto); // Se pasa número
            expect(result).toEqual([1, [mockArchivo]]);
            expect(service.actualizar).toHaveBeenCalledWith(1, dto);
        });
    });

    describe('eliminar', () => {
        it('debe eliminar un archivo', async () => {
            const dto: EliminarArchivosDto = { id: 1 };
            const result = await controller.eliminar(1, dto); // Se pasa número
            expect(result).toBeUndefined();
            expect(service.eliminar).toHaveBeenCalledWith(1, dto);
        });
    });
});
