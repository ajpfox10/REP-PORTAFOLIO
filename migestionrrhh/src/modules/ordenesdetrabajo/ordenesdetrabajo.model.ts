import {
    Column,
    Model,
    Table,
    DataType,
    PrimaryKey,
    AutoIncrement,
    CreatedAt
} from 'sequelize-typescript';
import {
    InferAttributes,
    InferCreationAttributes,
    CreationOptional
} from 'sequelize';

@Table({ tableName: 'ordenesdetrabajo', timestamps: false })
export class Ordenesdetrabajo extends Model<
    InferAttributes<Ordenesdetrabajo>,
    InferCreationAttributes<Ordenesdetrabajo>
> {
    @PrimaryKey
    @AutoIncrement
    @Column({
        type: DataType.INTEGER,
    })
    id!: CreationOptional<number>;

    @Column(DataType.STRING)
    descripcion!: string;

    @CreatedAt
    @Column(DataType.DATE)
    fechaDeAlta!: CreationOptional<Date>;

    @Column(DataType.STRING)
    usuarioCarga!: string;
}
