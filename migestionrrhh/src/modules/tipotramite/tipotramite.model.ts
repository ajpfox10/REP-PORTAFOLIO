

// src/modules/tipotramite/tipotramite.model.ts

import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'tipotramite', timestamps: true })
export class TipoTramite extends Model<TipoTramite> {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    ID!: number;

    @Column({ type: DataType.STRING(50), allowNull: false, defaultValue: '0' })
    TIPODETRAMITE!: string;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW })
    fechaDeAlta!: Date;

    @Column({ type: DataType.STRING })
    usuarioCarga!: string;
}
