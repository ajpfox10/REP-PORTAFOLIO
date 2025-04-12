import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Tareas } from './tareas.model';
import { CrearTareasDto } from './dto/crear-tareas.dto';

@Injectable()
export class TareasService {
    private readonly logger = new Logger(TareasService.name);

    constructor(
        @InjectModel(Tareas)
        private readonly model: typeof Tareas,
    ) { }

    async crear(data: CrearTareasDto, usuarioCarga: string): Promise<Tareas> {
        this.logger.log(`Creando nueva tarea para usuario: ${usuarioCarga}`);

        // Crear objeto con solo los campos necesarios
        const tareaData = {
            tarea: data.tarea,
            comentariosagenterealizo: data.comentariosagenterealizo,
            fechadebajadetarea: data.fechadebajadetarea,
            fechadealtadetarea: data.fechadealtadetarea,
            asifgnadoa: data.asifgnadoa,
            usuarioCarga,
            fechaDeAlta: new Date()
        };

        // Filtrar propiedades undefined
        const filteredData = Object.fromEntries(
            Object.entries(tareaData).filter(([_, value]) => value !== undefined)
        );

        return await this.model.create(filteredData as any);
    }

    async obtenerTodos(): Promise<Tareas[]> {
        this.logger.log('Obteniendo todas las tareas...');
        return await this.model.findAll();
    }

    async obtenerPorId(id: number): Promise<Tareas> {
        const registro = await this.model.findByPk(id);
        if (!registro) {
            this.logger.warn(`Tarea con ID ${id} no encontrada`);
            throw new NotFoundException(`Tarea con ID ${id} no encontrada`);
        }
        return registro;
    }

    async actualizar(id: number, data: Partial<CrearTareasDto>): Promise<Tareas> {
        this.logger.log(`Actualizando tarea ID: ${id}`);
        const registro = await this.obtenerPorId(id);
        await registro.update(data);
        return registro;
    }

    async eliminar(id: number): Promise<number> {
        const result = await this.model.destroy({ where: { id } });
        if (result === 0) {
            this.logger.warn(`Intento de eliminar tarea inexistente ID ${id}`);
            throw new NotFoundException(`Tarea con ID ${id} no encontrada`);
        }
        return result;
    }
}