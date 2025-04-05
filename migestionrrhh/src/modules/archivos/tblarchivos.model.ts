import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({ tableName: 'tblarchivos', timestamps: false })
export class Tblarchivos extends Model<Tblarchivos> {
    @Column({ primaryKey: true, autoIncrement: true })
    id!: number;

    @Column({ type: DataType.STRING, allowNull: false })
    nombreArchivo!: string;

    @Column({ type: DataType.STRING, allowNull: false })
    tipoArchivo!: string;

    @Column({ type: DataType.INTEGER, allowNull: false })
    ano!: number;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW })
    fechaDeAlta!: Date;

    @Column({ type: DataType.STRING, allowNull: true })
    usuarioCarga?: string;
}
