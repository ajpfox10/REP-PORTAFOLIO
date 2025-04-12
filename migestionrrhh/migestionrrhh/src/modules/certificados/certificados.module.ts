import { Table, Model, Column, DataType } from 'sequelize-typescript';

@Table({ tableName: 'certificados' })
export class Certificado extends Model<Certificado> {
    @Column({ primaryKey: true, autoIncrement: true })
    id!: number;

    @Column({ type: DataType.STRING, allowNull: false })
    descripcion!: string;

    @Column({ type: DataType.STRING, allowNull: true })
    path?: string;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW })
    fechaDeAlta!: Date;

    @Column({ type: DataType.STRING, allowNull: true })
    usuarioCarga?: string;
}
