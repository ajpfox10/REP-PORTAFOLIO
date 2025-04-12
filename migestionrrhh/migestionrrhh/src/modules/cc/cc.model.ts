// cc.model.ts
import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({ tableName: 'cc' })
export class Cc extends Model<Cc> {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @Column({ type: DataType.STRING })
    nombre!: string;

    @Column({ type: DataType.DATE })
    fechaDeAlta!: Date;

    @Column({ type: DataType.STRING })
    usuarioCarga!: string;
}
