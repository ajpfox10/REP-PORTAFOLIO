import { Test, TestingModule } from '@nestjs/testing';
import { TblarchivosService } from './tblarchivos.service';
import { Tblarchivos } from './tblarchivos.model';
import { getModelToken } from '@nestjs/sequelize';
import '../../test/utils/test-setup';  // Ajusta la ruta según corresponda

describe('TblarchivosService', () => {
    let service: TblarchivosService;
    let modelMock: Partial<typeof Tblarchivos>;

    beforeEach(async () => {
        modelMock = {
            create: jest.fn(),
            findAll: jest.fn(),
            findByPk: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TblarchivosService,
                { provide: getModelToken(Tblarchivos), useValue: modelMock },
            ],
        }).compile();

        service = module.get<TblarchivosService>(TblarchivosService);
    });

    it('debería crear un archivo', async () => {
        const dto = { nombreArchivo: 'test.txt', tipoArchivo: 'text/plain', ano: 2024, usuarioCarga: 'admin' } as any;
        const created = { id: 1, ...dto, fechaDeAlta: new Date() };
        (modelMock.create as jest.Mock).mockResolvedValue(created);

        const result = await service.crear(dto);
        expect(modelMock.create).toHaveBeenCalledWith({
            ...dto,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería retornar todos los archivos', async () => {
        const archivos = [{ id: 1, nombreArchivo: 'a.txt' }];
        (modelMock.findAll as jest.Mock).mockResolvedValue(archivos);

        const result = await service.obtenerTodos();
        expect(modelMock.findAll).toHaveBeenCalled();
        expect(result).toEqual(archivos);
    });

    it('debería retornar un archivo por ID', async () => {
        const fakeArchivo = { id: 1, update: jest.fn(), destroy: jest.fn() };
        (modelMock.findByPk as jest.Mock).mockResolvedValue(fakeArchivo);

        const result = await service.obtenerPorId(1);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(result).toEqual(fakeArchivo);
    });

    it('debería actualizar un archivo', async () => {
        const dto = { nombreArchivo: 'actualizado.txt' } as any;
        const fakeArchivo = {
            id: 1,
            update: jest.fn().mockResolvedValue({ id: 1, ...dto }),
        };
        (modelMock.findByPk as jest.Mock).mockResolvedValue(fakeArchivo);

        const result = await service.actualizar(1, dto);
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(fakeArchivo.update).toHaveBeenCalledWith(dto);
        expect(result).toMatchObject({ id: 1, ...dto });
    });

    it('debería eliminar un archivo', async () => {
        const fakeArchivo = { id: 1, destroy: jest.fn().mockResolvedValue(undefined) };
        (modelMock.findByPk as jest.Mock).mockResolvedValue(fakeArchivo);

        await expect(service.eliminar(1, { motivo: 'baja' } as any)).resolves.toBeUndefined();
        expect(modelMock.findByPk).toHaveBeenCalledWith(1);
        expect(fakeArchivo.destroy).toHaveBeenCalled();
    });
});
