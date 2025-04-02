import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Usuario } from '../../database/models/usuario.model';
import { CreateUsuarioDto } from './dto/usuario.dto';
import * as bcrypt from 'bcrypt';
import { CreationAttributes } from 'sequelize';
@Injectable()
export class UsuarioService {
    constructor(
        @InjectModel(Usuario)
        private readonly usuarioModel: typeof Usuario,
    ) { }

    async crearUsuario(dto: CreateUsuarioDto): Promise<Usuario> {
        const passwordHasheado = await bcrypt.hash(dto.password, 10);
        const usuario = await this.usuarioModel.create({
            nombreUsuario: dto.nombreUsuario,
            email: dto.email,
            servicio: dto.servicio,
            sector: dto.sector,
            rol: dto.rol,
            lvl: dto.lvl,
            password: passwordHasheado,
            telefono: dto.telefono,
            createdAt: dto.createdAt,
            updatedAt: dto.updatedAt,
        } as CreationAttributes<Usuario>);

        return usuario;
    }

    async obtenerTodos(): Promise<Usuario[]> {
        return this.usuarioModel.findAll();
    }

    async obtenerPorId(id: number): Promise<Usuario> {
        const usuario = await this.usuarioModel.findByPk(id);
        if (!usuario) {
            throw new NotFoundException(`Usuario con id ${id} no encontrado.`);
        }
        return usuario;
    }
}
