import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';

export interface ResolucionAttributes {
  id: number;
  resolucion: string;
  fechaDeAlta: Date;
  usuarioCarga: string;
}

export interface ResolucionCreationAttributes extends Optional<ResolucionAttributes, 'id' | 'fechaDeAlta'> {}

@Table({ tableName: 'resoluciones', timestamps: false })
export class Resolucion extends Model<ResolucionAttributes, ResolucionCreationAttributes> implements ResolucionAttributes {
  @Column({ type: DataType.INTEGER, autoIncrement: true, primaryKey: true })
  id!: number;

  @Column({ type: DataType.STRING })
  resolucion!: string;

  @Column({ type: DataType.DATE, defaultValue: DataType.NOW })
  fechaDeAlta!: Date;

  @Column({ type: DataType.STRING })
  usuarioCarga!: string;
}