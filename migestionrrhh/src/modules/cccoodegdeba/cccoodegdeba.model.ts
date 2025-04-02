// Modelo Sequelize para el módulo cccoodegdeba
import {
    Table,
    Column,
    Model,
    DataType,
    PrimaryKey,
    AutoIncrement
} from 'sequelize-typescript';
import {
    CreationOptional,
    InferAttributes,
    InferCreationAttributes
} from 'sequelize';

@Table({ tableName: 'cccoodegdeba', timestamps: false })
export class CCCoodegdeba extends Model<
    InferAttributes<CCCoodegdeba>,
    InferCreationAttributes<CCCoodegdeba>
> {
    @PrimaryKey
    @AutoIncrement
    @Column({ type: DataType.INTEGER })
    id!: CreationOptional<number>;

    @Column({ type: DataType.STRING, allowNull: false })
    descripcion!: string;
}
