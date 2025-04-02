// Modelo Sequelize para el módulo cc
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

@Table({ tableName: 'ccmodel', timestamps: false })
export class CCModel extends Model<
    InferAttributes<CCModel>,
    InferCreationAttributes<CCModel>
> {
    @PrimaryKey
    @AutoIncrement
    @Column({ type: DataType.INTEGER })
    id!: CreationOptional<number>;

    @Column({ type: DataType.STRING, allowNull: false })
    nombre!: string;
}
