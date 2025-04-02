// Modelo Sequelize para el módulo certificados
import {
    Table,
    Column,
    Model,
    DataType,
    PrimaryKey,
    AutoIncrement,
    CreatedAt,
    UpdatedAt,
} from 'sequelize-typescript';
import {
    CreationOptional,
    InferAttributes,
    InferCreationAttributes,
} from 'sequelize';

@Table({
    tableName: 'certificados',
    timestamps: true, // Si usás createdAt y updatedAt
    // freezeTableName: true, // Opcional, si no querés que se pluralice
})
export class Certificados extends Model<
    InferAttributes<Certificados>,
    InferCreationAttributes<Certificados>
> {
    @PrimaryKey
    @AutoIncrement
    @Column({ type: DataType.INTEGER })
    id!: CreationOptional<number>;

    @Column({ type: DataType.STRING, allowNull: false })
    nombre!: string;

    @Column({ type: DataType.STRING, allowNull: false })
    descripcion!: string;

    @CreatedAt
    @Column({ type: DataType.DATE })
    fechaCreacion!: CreationOptional<Date>;

    @UpdatedAt
    @Column({ type: DataType.DATE })
    fechaActualizacion!: CreationOptional<Date>;

    @Column({ type: DataType.STRING, allowNull: false })
    usuarioCarga!: string;
}
