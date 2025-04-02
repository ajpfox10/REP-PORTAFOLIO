// Modelo Sequelize para el módulo categoria
import {
    Table,
    Column,
    Model,
    DataType,
    PrimaryKey,
    AutoIncrement,
} from 'sequelize-typescript';
import {
    CreationOptional,
    InferAttributes,
    InferCreationAttributes,
} from 'sequelize';

@Table({ tableName: 'categoria', timestamps: false })
export class Categoria extends Model<
    InferAttributes<Categoria>,
    InferCreationAttributes<Categoria>
> {
    @PrimaryKey
    @AutoIncrement
    @Column({ type: DataType.INTEGER })
    id!: CreationOptional<number>;

    @Column({ type: DataType.STRING, allowNull: false })
    nombre!: string;
}
