import { Test, TestingModule } from '@nestjs/testing';
import { SectorService } from './sector.service';
import { getModelToken } from '@nestjs/sequelize';
import { Sector } from './sector.model';
import { NotFoundException } from '@nestjs/common';

describe('SectorService', () => {
    let service: SectorService;
    let modelMock: any;

    beforeEach(async () => {
        // Mock del modelo
        modelMock = {
            findByPk: jest.fn(),
            destroy: jest.fn()
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SectorService,
                {
                    provide: getModelToken(Sector),
                    useValue: modelMock,
                },
            ],
        }).compile();

        service = module.get<SectorService>(SectorService);
    });

    describe('eliminar()', () => {
        it('debería lanzar NotFoundException si el sector no existe', async () => {
            // Configurar el mock para simular que no encontró el sector
            modelMock.findByPk.mockResolvedValueOnce(null);

            await expect(service.eliminar(999)).rejects.toThrow(NotFoundException);
            expect(modelMock.findByPk).toHaveBeenCalledWith(999);
            expect(modelMock.destroy).not.toHaveBeenCalled();
        });

        it('debería eliminar el sector si existe', async () => {
            // Configurar el mock para simular que encontró el sector
            modelMock.findByPk.mockResolvedValueOnce({ id: 1 });
            modelMock.destroy.mockResolvedValueOnce(1);

            const result = await service.eliminar(1);
            expect(result).toBe(1);
            expect(modelMock.destroy).toHaveBeenCalledWith({ where: { id: 1 } });
        });
    });
});