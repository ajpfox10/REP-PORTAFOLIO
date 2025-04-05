import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Tblarchivos } from './tblarchivos.model';
import { CrearArchivoDto } from './dto/crear-archivo.dto';
import { ActualizarArchivoDto } from './dto/actualizar-archivo.dto';
import { EliminarArchivosDto } from './dto/eliminar-archivos.dto';

@Injectable()
export class TblarchivosService {
    constructor(
        @InjectModel(Tblarchivos)
        private readonly model: typeof Tblarchivos,
    ) { }

    async crear(dto: CrearArchivoDto): Promise<Tblarchivos> {
        return this.model.create({ ...dto, fechaDeAlta: new Date() } as any);
    }
    async obtenerTodos(): Promise<Tblarchivos[]> {
        return this.model.findAll();
    }
    async obtenerPorId(id: number): Promise<Tblarchivos> {
        const archivo = await this.model.findByPk(id);
        if (!archivo) throw new NotFoundException(`Archivo con ID ${id} no encontrado`);
        return archivo;
    }
    async actualizar(id: number, dto: Partial<Tblarchivos>): Promise<[number, Tblarchivos[]]> {
        return this.model.update(dto, {
            where: { id },
            returning: true,
        });
    }
    async eliminar(id: number, _dto: EliminarArchivosDto): Promise<void> {
        const archivo = await this.obtenerPorId(id);
        await archivo.destroy();
    }
}
