import {
    Table,
    Column,
    Model,
    DataType,
    PrimaryKey,
    AutoIncrement,
    CreatedAt,
    AllowNull
} from 'sequelize-typescript';
import {
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
} from 'sequelize';

@Table({ tableName: 'localidades1', timestamps: false })
export class Localidades1 extends Model<
    InferAttributes<Localidades1>,
    InferCreationAttributes<Localidades1>
> {
    @PrimaryKey
    @AutoIncrement
    @Column({ type: DataType.INTEGER })
    id!: CreationOptional<number>;

    @AllowNull(false)
    @Column({ type: DataType.STRING })
    nombre!: string;

    @AllowNull(true)
    @Column({ type: DataType.STRING })
    descripcion?: string;

    @CreatedAt
    @Column({ type: DataType.DATE })
    fechaDeAlta!: CreationOptional<Date>;

    @AllowNull(false)
    @Column({ type: DataType.STRING })
    usuarioCarga!: string;
}
