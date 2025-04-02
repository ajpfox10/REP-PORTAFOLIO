// Modelo Sequelize para el módulo cargosdeinicio
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

@Table({ tableName: 'cargosdeinicio', timestamps: false })
export class CargosDeInicio extends Model<
    InferAttributes<CargosDeInicio>,
    InferCreationAttributes<CargosDeInicio>
> {
    @PrimaryKey
    @AutoIncrement
    @Column({ type: DataType.INTEGER })
    id!: CreationOptional<number>;

    @Column({ type: DataType.STRING, allowNull: false })
    cargo!: string;
}
