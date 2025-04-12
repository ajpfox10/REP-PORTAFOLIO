import { Column, Model, Table, DataType } from 'sequelize-typescript';

@Table({ tableName: 'cargosdeinicio' })
export class Cargosdeinicio extends Model<Cargosdeinicio> {
    @Column({ primaryKey: true, autoIncrement: true })
    id!: number;

    @Column({ type: DataType.STRING })
    cargo!: string;

    @Column({ type: DataType.STRING })
    descripcion!: string;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW })
    fechaDeAlta!: Date;

    @Column({ type: DataType.STRING })
    usuarioCarga!: string;
}
