import {
    Table,
    Column,
    Model,
    DataType,
    PrimaryKey,
    AutoIncrement,
} from 'sequelize-typescript';

@Table({ tableName: 'tareasadquiridias', timestamps: false })
export class Tareasadquiridias extends Model<Tareasadquiridias> {
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
        type: DataType.TEXT,
        allowNull: true,
    })
    descripcion!: string;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
    })
    fechaDeAlta!: Date;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    usuarioCarga!: string;
}
