import { Test, TestingModule } from '@nestjs/testing';
import { ScaneardocumentacionService } from './scaneardocumentacion.service';

describe('ScaneardocumentacionService', () => {
    let service: ScaneardocumentacionService;

    const dtoCrear = {
        archivo: 'archivo.pdf',
        descripcion: 'Contrato escaneado',
        path: '/uploads/archivo.pdf',
        usuarioCarga: 'admin',
    };

    const dtoActualizar = {
        archivo: 'archivo_editado.pdf',
        descripcion: 'Contrato actualizado',
        path: '/uploads/archivo_editado.pdf',
    };

    const mockRepository = {
        create: jest.fn().mockResolvedValue({ id: 1, ...dtoCrear, fechaDeAlta: new Date() }),
        findAll: jest.fn().mockResolvedValue([{ id: 1 }]),
        findByPk: jest.fn().mockImplementation((id: number) =>
            id === 1
                ? Promise.resolve({
                    id: 1,
                    update: jest.fn().mockResolvedValue({ id: 1, ...dtoActualizar }),
                    destroy: jest.fn().mockResolvedValue(1),
                })
                : Promise.resolve(null)
        ),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ScaneardocumentacionService,
                {
                    provide: 'ScaneardocumentacionRepository',
                    useValue: mockRepository,
                },
            ],
        }).compile();

        service = module.get<ScaneardocumentacionService>(ScaneardocumentacionService);
    });

    it('debería crear un documento', async () => {
        const result = await service.crear(dtoCrear);

        expect(mockRepository.create).toHaveBeenCalledWith({
            ...dtoCrear,
            fechaDeAlta: expect.any(Date),
        });
        expect(result).toMatchObject({ id: 1, ...dtoCrear });
    });

    it('debería lanzar NotFoundException si no existe el documento al obtener', async () => {
        await expect(service.obtenerPorId(999)).rejects.toThrow();
    });

    it('debería actualizar un documento', async () => {
        const result = await service.actualizar(1, dtoActualizar);

        expect(result).toMatchObject({ id: 1, ...dtoActualizar });
    });

    it('debería eliminar un documento', async () => {
        const result = await service.eliminar(1);

        expect(result).toBe(1);
    });
});
