import {
    Table,
    Column,
    Model,
    DataType,
    PrimaryKey,
    AutoIncrement,
    AllowNull,
    CreatedAt,
} from 'sequelize-typescript';
import { CreationOptional } from 'sequelize';

@Table({
    tableName: 'ocupacion1',
    timestamps: false,
})
export class Ocupacion1 extends Model<Ocupacion1> {
    @PrimaryKey
    @AutoIncrement
    @Column({
        type: DataType.INTEGER,
    })
    id!: CreationOptional<number> | undefined;

    @AllowNull(false)
    @Column({
        type: DataType.STRING,
    })
    nombre!: string | undefined;

    @CreatedAt
    @Column({
        field: 'fechaDeAlta',
        type: DataType.DATE,
    })
    fechaDeAlta!: CreationOptional<Date> | undefined;

    @AllowNull(false)
    @Column({
        type: DataType.STRING,
    })
    usuarioCarga!: string | undefined;
}
