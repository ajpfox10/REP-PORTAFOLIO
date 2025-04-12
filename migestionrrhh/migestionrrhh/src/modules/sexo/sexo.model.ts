import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'sexo', timestamps: false })
export class Sexo extends Model<Sexo> {
    @Column({
        type: DataType.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    })
    id!: number;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    descripcion!: string;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
    })
    fechaDeAlta!: Date;

    @Column({
        type: DataType.STRING,
        allowNull: true,
    })
    usuarioCarga?: string;
}
