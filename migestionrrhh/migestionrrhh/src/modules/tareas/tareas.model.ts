import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'tareas', timestamps: false })
export class Tareas extends Model<Tareas> {
  @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
  ID!: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  comentariosagenterealizo!: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  tarea!: string;

  @Column({ type: DataType.DATE, allowNull: true })
  fechadebajadetarea!: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  fechadealtadetarea!: Date;

  @Column({ type: DataType.TEXT, allowNull: true })
  asifgnadoa!: string;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  fechaDeAlta!: Date;

  @Column({ type: DataType.STRING, allowNull: false })
  usuarioCarga!: string;
}