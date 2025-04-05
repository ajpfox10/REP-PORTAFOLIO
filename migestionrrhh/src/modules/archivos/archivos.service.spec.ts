// src/modules/archivos/tblarchivos.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { TblarchivosService } from './tblarchivos.service';
import { Tblarchivos } from './tblarchivos.model';
import { getModelToken } from '@nestjs/sequelize';
import { EliminarArchivosDto } from './dto/eliminar-archivos.dto';

const mockArchivo = {
    id: 1,
    nombreArchivo: 'documento.pdf',
    tipoArchivo: 'pdf',
    ano: 2024,
    usuarioCarga: 'admin',
    fechaDeAlta: new Date(),
};

describe('TblarchivosService', () => {
    let service: TblarchivosService;
    let model: any;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TblarchivosService,
                {
                    provide: getModelToken(Tblarchivos),
                    useValue: {
                        create: jest.fn().mockResolvedValue(mockArchivo),
                        findAll: jest.fn().mockResolvedValue([mockArchivo]),
                        findByPk: jest.fn().mockResolvedValue(mockArchivo),
                        update: jest.fn().mockResolvedValue([1, [mockArchivo]]),
                        destroy: jest.fn().mockResolvedValue(1),
                    },
                },
            ],
        }).compile();

        service = module.get<TblarchivosService>(TblarchivosService);
        model = module.get(getModelToken(Tblarchivos));
    });

    it('debe estar definido', () => {
        expect(service).toBeDefined();
    });

    it('crear() debe crear un archivo', async () => {
        const dto = {
            nombreArchivo: 'documento.pdf',
            tipoArchivo: 'pdf',
            ano: 2024,
            usuarioCarga: 'admin',
        };
        const result = await service.crear(dto);
        expect(result).toEqual(mockArchivo);
        expect(model.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
    });

    it('obtenerTodos() debe devolver todos los archivos', async () => {
        const result = await service.obtenerTodos();
        expect(result).toEqual([mockArchivo]);
    });

    it('obtenerPorId() debe devolver un archivo por ID', async () => {
        const result = await service.obtenerPorId(1);
        expect(result).toEqual(mockArchivo);
        expect(model.findByPk).toHaveBeenCalledWith(1);
    });

    it('actualizar() debe actualizar y devolver [1, [entidad]]', async () => {
        const dto = { nombreArchivo: 'nuevo.pdf' };
        const result = await service.actualizar(1, dto);
        expect(result).toEqual([1, [mockArchivo]]);
        expect(model.update).toHaveBeenCalledWith(dto, { where: { id: 1 }, returning: true });
    });

    it('eliminar() debe eliminar el archivo', async () => {
        // Creamos un spy para el método destroy que retornará una promesa resuelta.
        const destroySpy = jest.fn().mockResolvedValue(undefined);
        // Preparamos un objeto "archivo" que incluya el método destroy.
        const archivoConDestroy = { ...mockArchivo, destroy: destroySpy };

        // Modificamos el mock de findByPk para que retorne el objeto con destroy.
        model.findByPk = jest.fn().mockResolvedValue(archivoConDestroy);

        // Definimos un DTO válido para eliminar, asumiendo que EliminarArchivosDto requiere una propiedad "id".
        const dto: EliminarArchivosDto = { id: 1 };

        // Llamamos al método pasando ambos argumentos.
        const result = await service.eliminar(1, dto);

        // Como el método retorna void, el resultado debe ser undefined.
        expect(result).toBeUndefined();

        // Verificamos que se llamó a findByPk con el id correcto.
        expect(model.findByPk).toHaveBeenCalledWith(1);

        // Verificamos que se llamó al método destroy del objeto archivo.
        expect(destroySpy).toHaveBeenCalled();
    });
});
