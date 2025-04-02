import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';

export interface LeyAttributes {
  id: number;
  ley: string;
  codigoleyes: number;
  leyactiva: number;
  fechaDeAlta: Date;
  usuarioCarga: string;
}

export interface LeyCreationAttributes extends Optional<LeyAttributes, 'id' | 'fechaDeAlta'> {}

@Table({ tableName: 'leyes', timestamps: false })
export class Ley extends Model<LeyAttributes, LeyCreationAttributes> implements LeyAttributes {
  @Column({ type: DataType.INTEGER, autoIncrement: true, primaryKey: true })
  id!: number;

  @Column({ type: DataType.STRING })
  ley!: string;

  @Column({ type: DataType.INTEGER })
  codigoleyes!: number;

  @Column({ type: DataType.INTEGER })
  leyactiva!: number;

  @Column({ type: DataType.DATE, defaultValue: DataType.NOW })
  fechaDeAlta!: Date;

  @Column({ type: DataType.STRING })
  usuarioCarga!: string;
}