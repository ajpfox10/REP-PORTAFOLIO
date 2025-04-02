import { Table, Column, Model, PrimaryKey, AutoIncrement, DataType } from 'sequelize-typescript';

@Table({ tableName: 'scaneardocumentacion' })
export class Scaneardocumentacion extends Model<Scaneardocumentacion> {
    @PrimaryKey
    @AutoIncrement
    @Column(DataType.INTEGER)
    id!: number;

    @Column
    descripcion!: string;

    @Column
    path!: string;

    @Column
    usuarioCarga!: string;

    @Column
    fechaDeAlta!: Date;
}
