import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Tareas } from './tareas.model';
import { CrearTareasDto } from './dto/crear-tareas.dto';
import { ActualizarTareasDto } from './dto/actualizar-tareas.dto';

@Injectable()
export class TareasService {
    constructor(
        @InjectModel(Tareas)
        private tareasModel: typeof Tareas,
    ) { }

    async crear(dto: CrearTareasDto, usuario: string): Promise<Tareas> {
        return this.tareasModel.create({
            ...(dto as any),
            fechaDeAlta: new Date(),
            usuarioCarga: usuario,
        });
    }

    async obtenerTodos(): Promise<Tareas[]> {
        return this.tareasModel.findAll();
    }

    async obtenerPorId(id: number): Promise<Tareas> {
        const tarea = await this.tareasModel.findByPk(id);
        if (!tarea) {
            throw new NotFoundException(`Tarea con ID ${id} no encontrada`);
        }
        return tarea;
    }

    async actualizar(id: number, dto: ActualizarTareasDto): Promise<Tareas> {
        const tarea = await this.obtenerPorId(id);
        if (!tarea) {
            throw new NotFoundException(`Tarea con ID ${id} no encontrada`);
        }
        await tarea.update(dto);
        return tarea;
    }

    async eliminar(id: number): Promise<void> {
        const tarea = await this.obtenerPorId(id);
        if (!tarea) {
            throw new NotFoundException(`Tarea con ID ${id} no encontrada`);
        }
        await tarea.destroy();
    }

}