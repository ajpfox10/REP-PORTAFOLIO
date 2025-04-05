import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Tareasadquiridias } from './tareasadquiridias.model';
import { CrearTareasadquiridiasDto } from './dto/crear-tareasadquiridias.dto';
import { ActualizarTareasadquiridiasDto } from './dto/actualizar-tareasadquiridias.dto';

@Injectable()
export class TareasadquiridiasService {
    constructor(
        @InjectModel(Tareasadquiridias)
        private readonly tareasadquiridiasModel: typeof Tareasadquiridias,
    ) { }

    async crear(dataSanitizada: CrearTareasadquiridiasDto, usuario: string): Promise<Tareasadquiridias> {
        return this.tareasadquiridiasModel.create({
            ...(dataSanitizada as any),
            fechaDeAlta: new Date(),
            usuarioCarga: usuario,
        });
    }

    async obtenerTodos(): Promise<Tareasadquiridias[]> {
        return this.tareasadquiridiasModel.findAll();
    }

    async obtenerPorId(id: number): Promise<Tareasadquiridias> {
        const tarea = await this.tareasadquiridiasModel.findByPk(id);
        if (!tarea) {
            throw new NotFoundException(`Tarea adquirida con ID ${id} no encontrada`);
        }
        return tarea;
    }

    async eliminar(id: number): Promise<void> {
        const tarea = await this.tareasadquiridiasModel.findByPk(id);
        if (tarea) {
            await tarea.destroy();
        }
    }
    async actualizar(id: number, dto: ActualizarTareasadquiridiasDto): Promise<Tareasadquiridias> {
        const tarea = await this.obtenerPorId(id);
        await tarea.update(dto);
        return tarea;
    }
}