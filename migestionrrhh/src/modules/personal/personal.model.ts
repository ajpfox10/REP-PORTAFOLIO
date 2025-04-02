import { Column, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'personal' })
export class Personal extends Model {
    @Column({ primaryKey: true, autoIncrement: true })
    CODIGOCLI!: number;

    // Agregar nuevos campos aquí (preferentemente al final para evitar problemas de migración)
}
