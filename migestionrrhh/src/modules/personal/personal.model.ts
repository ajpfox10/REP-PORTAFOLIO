import { Column, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'personal' })
export class Personal extends Model {
    @Column({ primaryKey: true, autoIncrement: true })
    CODIGOCLI!: number;

    @Column
    nombre!: string;

    @Column
    apellido!: string;

    @Column
    dni!: string;

    @Column
    sexo!: string;

    @Column
    cargo!: string;

    @Column
    usuarioCarga!: string;

    @Column
    fechaNacimiento?: Date;

    @Column
    fechaDeAlta?: Date;
}
