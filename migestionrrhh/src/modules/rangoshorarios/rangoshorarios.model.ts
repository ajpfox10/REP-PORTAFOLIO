import { Column, Model, Table, DataType, PrimaryKey, AutoIncrement } from 'sequelize-typescript';

@Table({ tableName: 'rangoshorarios', timestamps: false })
export class Rangoshorarios extends Model<Rangoshorarios> {
    @PrimaryKey
    @AutoIncrement
    @Column(DataType.INTEGER)
    id!: number;

    @Column(DataType.STRING)
    descripcion!: string;

    @Column(DataType.DATE)
    fechaDeAlta!: Date;

    @Column(DataType.STRING)
    usuarioCarga!: string;
}
