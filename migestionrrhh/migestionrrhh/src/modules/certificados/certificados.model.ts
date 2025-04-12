import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({ tableName: 'certificados', timestamps: true })
export class Certificados extends Model {
    @Column({ primaryKey: true, autoIncrement: true })
    id!: number;

    @Column(DataType.STRING)
    nombre!: string;

    @Column(DataType.STRING)
    descripcion!: string;

    @Column(DataType.STRING)
    usuarioCarga!: string;

    @Column({ type: DataType.DATE })
    fechaDeAlta!: Date;
}
