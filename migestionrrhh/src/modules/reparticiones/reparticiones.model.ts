import { Table, Column, Model, PrimaryKey, AutoIncrement, DataType } from 'sequelize-typescript';

@Table({ tableName: 'reparticiones', timestamps: false })
export class Reparticiones extends Model<Reparticiones> {
    @PrimaryKey
    @AutoIncrement
    @Column({ type: DataType.INTEGER })
    id!: number;

    @Column
    codigo!: string;

    @Column
    descripcion!: string;

    @Column
    abreviatura!: string;

    @Column({ type: DataType.DATE })
    fechaDeAlta!: Date;

    @Column
    usuarioCarga!: string;
}
