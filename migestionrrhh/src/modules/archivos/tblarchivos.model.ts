import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({ tableName: 'tblarchivos', timestamps: false })
export class TblArchivos extends Model<TblArchivos> {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @Column({ type: DataType.STRING })
    Ruta!: string;

    @Column({ type: DataType.STRING })
    Archivo!: string;

    @Column({ type: DataType.STRING })
    TIPO!: string;

    @Column({ type: DataType.STRING })
    NUMERO!: string;

    @Column({ type: DataType.STRING })
    AÑO!: string;

    @Column({ type: DataType.INTEGER })
    idss!: number;

    @Column({ type: DataType.STRING })
    procesada!: string;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW })
    fechaDeAlta!: Date;

    @Column({ type: DataType.STRING })
    usuarioCarga!: string;
}