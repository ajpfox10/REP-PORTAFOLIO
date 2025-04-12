import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'usuarios', timestamps: true })
export class Usuario extends Model<Usuario> {
    @Column({
        type: DataType.STRING(50),
        allowNull: false,
    })
    nombreUsuario!: string;

    @Column({
        type: DataType.STRING(100),
        allowNull: false,
        unique: true,
    })
    email!: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: false,
    })
    servicio!: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: false,
    })
    sector!: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: false,
    })
    rol!: string;

    @Column({
        type: DataType.INTEGER,
        allowNull: false,
    })
    lvl!: number;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    password!: string;

    @Column({
        type: DataType.STRING,
        allowNull: true,
    })
    telefono?: string;

    @Column({ type: DataType.STRING, allowNull: true })
    refreshToken!: string;

}
