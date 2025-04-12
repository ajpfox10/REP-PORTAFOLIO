import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Usuario } from '../../modules/usuario/usuario.model';
import { CreateUsuarioDto } from './dto/usuario.dto';
import * as bcrypt from 'bcrypt';
import { CreationAttributes } from 'sequelize';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import * as Sentry from '@sentry/node';

@Injectable()
export class UsuarioService {
    [x: string]: any;
    private readonly logger = new Logger(UsuarioService.name);

    constructor(
        @InjectModel(Usuario)
        private readonly usuarioModel: typeof Usuario,
    ) {}

    async crearUsuario(dto: CreateUsuarioDto): Promise<Usuario> {
        try {
            this.logger.log(`Creando usuario ${dto.email}`);
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
        } catch (error) {
            this.logger.error('Error al crear usuario', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerTodos(): Promise<Usuario[]> {
        try {
            this.logger.log('Obteniendo todos los usuarios');
            return await this.usuarioModel.findAll();
        } catch (error) {
            this.logger.error('Error al obtener usuarios', error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async obtenerPorId(id: number): Promise<Usuario> {
        try {
            this.logger.log(`Buscando usuario con ID ${id}`);
            const usuario = await this.usuarioModel.findByPk(id);
            if (!usuario) {
                this.logger.warn(`Usuario con id ${id} no encontrado`);
                throw new NotFoundException(`Usuario con id ${id} no encontrado.`);
            }
            return usuario;
        } catch (error) {
            this.logger.error(`Error al obtener usuario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async actualizar(id: number, dto: ActualizarUsuarioDto): Promise<Usuario> {
        try {
            this.logger.log(`Actualizando usuario con ID ${id}`);
            const usuario = await this.obtenerPorId(id);
            await usuario.update(dto);
            return usuario;
        } catch (error) {
            this.logger.error(`Error al actualizar usuario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async eliminar(id: number): Promise<void> {
        try {
            this.logger.log(`Eliminando usuario con ID ${id}`);
            const usuario = await this.obtenerPorId(id);
            await usuario.destroy();
        } catch (error) {
            this.logger.error(`Error al eliminar usuario ID ${id}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }

    async guardarRefreshToken(userId: number, refreshToken: string): Promise<void> {
        try {
            this.logger.log(`Guardando refresh token para usuario ID ${userId}`);
            const usuario = await this.usuarioModel.findByPk(userId);
            if (!usuario) {
                throw new NotFoundException(`Usuario con id ${userId} no encontrado.`);
            }
            usuario.refreshToken = refreshToken;
            await usuario.save();
        } catch (error) {
            this.logger.error(`Error al guardar refresh token del usuario ID ${userId}`, error);
            Sentry.captureException(error);
            throw error;
        }
    }
}
