// Modelo Sequelize para el módulo cedula
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

@Table({ tableName: 'cedula', timestamps: false })
export class Cedula extends Model<
    InferAttributes<Cedula>,
    InferCreationAttributes<Cedula>
> {
    @PrimaryKey
    @AutoIncrement
    @Column({ type: DataType.INTEGER })
    id!: CreationOptional<number>;

    @Column({ type: DataType.STRING, allowNull: false })
    numero!: string;
    @Column({ type: DataType.STRING, allowNull: false })
    usuarioCarga!: string;
    @Column({ type: DataType.DATE, allowNull: true })
    fechaEmision?: Date;
}
