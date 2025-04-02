// src/modules/leyes/leyes.model.ts
import { Column, Model, Table, DataType } from 'sequelize-typescript';

@Table({ tableName: 'leyes', timestamps: false })
export class Ley extends Model<Ley> {
	@Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
	IDLEY!: number;

	@Column({ type: DataType.STRING(200) })
	Ley!: string;

	@Column(DataType.INTEGER)
	codigoleyes!: number;

	@Column(DataType.INTEGER)
	leyactiva!: number;

	@Column({ type: DataType.DATE, defaultValue: DataType.NOW })
	fechaDeAlta!: Date;

	@Column(DataType.STRING)
	usuarioCarga!: string;
}
