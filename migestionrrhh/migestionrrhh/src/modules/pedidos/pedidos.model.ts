import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement } from 'sequelize-typescript';

@Table({ tableName: 'pedidos', timestamps: false })
export class Pedidos extends Model<Pedidos> {
    @PrimaryKey
    @AutoIncrement
    @Column({
        type: DataType.INTEGER,
    })
    id!: number;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    nombre!: string;

    @Column({
        type: DataType.STRING,
        allowNull: true,
    })
    descripcion!: string;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
    })
    fechaDeAlta!: Date;
}
