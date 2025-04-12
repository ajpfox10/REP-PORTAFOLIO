﻿import '../../test/utils/test-setup'; // ✅ mocks globales activos

import { Test, TestingModule } from '@nestjs/testing';
import { CedulaController } from './cedula.controller';
import { CedulaService } from './cedula.service';
import { CrearCedulaDto } from './dto/cedula.dto';
import { ActualizarCedulaDto } from './dto/actualizar-cedula.dto';

describe('CedulaController', () => {
    let controller: CedulaController;
    let service: CedulaService;

    const mockService = {
        crear: jest.fn(dto => ({ id: 1, ...dto })),
        obtenerTodos: jest.fn(() => [{ id: 1, numero: '123', titular: 'Juan Pérez', usuarioCarga: 'admin' }]),
        obtenerPorId: jest.fn(id => ({ id, numero: '123', titular: 'Juan Pérez', usuarioCarga: 'admin' })),
        actualizar: jest.fn((id, dto) => ({ id, ...dto })),
        eliminar: jest.fn(id => ({ deleted: true })),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CedulaController],
            providers: [{ provide: CedulaService, useValue: mockService }],
        }).compile();

        controller = module.get<CedulaController>(CedulaController);
        service = module.get<CedulaService>(CedulaService);
    });

    it('debería estar definido', () => {
        expect(controller).toBeDefined();
    });

    it('crear() debe retornar el objeto creado', async () => {
        const dto: CrearCedulaDto = {
            numero: '123',
            fechaEmision: new Date('2024-03-31'),
            titular: 'Juan Pérez',
            domicilio: 'Dirección X',
            usuarioCarga: 'admin',
        };
        const result = await controller.crear(dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('obtenerTodos() debe retornar lista de objetos', async () => {
        const result = await controller.obtenerTodos();
        expect(result).toEqual([
            { id: 1, numero: '123', titular: 'Juan Pérez', usuarioCarga: 'admin' },
        ]);
    });

    it('obtenerPorId() debe retornar un objeto por ID', async () => {
        const result = await controller.obtenerPorId(1);
        expect(result).toEqual({
            id: 1,
            numero: '123',
            titular: 'Juan Pérez',
            usuarioCarga: 'admin',
        });
    });

    it('actualizar() debe retornar el objeto actualizado', async () => {
        const dto: ActualizarCedulaDto = {
            numero: '456',
            fechaEmision: new Date('2024-04-01'),
            titular: 'Maria López',
            usuarioCarga: 'admin',
        };
        const result = await controller.actualizar(1, dto);
        expect(result).toEqual({ id: 1, ...dto });
    });

    it('eliminar() debe retornar confirmación de borrado', async () => {
        const result = await controller.eliminar(1);
        expect(result).toEqual({ deleted: true });
    });
});
